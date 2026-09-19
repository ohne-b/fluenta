//! Supervised native processes shared by speech and tutor workers.
use std::{
    fs::File,
    io::{Seek, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

pub type Cancellation = Arc<AtomicBool>;
pub fn cancellation() -> Cancellation {
    Arc::new(AtomicBool::new(false))
}
pub fn is_cancelled(token: &Cancellation) -> bool {
    token.load(Ordering::Relaxed)
}
pub fn cancel(token: &Cancellation) {
    token.store(true, Ordering::Relaxed);
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("operation.cancelled")]
    Cancelled,
    #[error("operation.timed_out")]
    TimedOut,
    #[error("native.worker_failed")]
    WorkerFailed,
    #[error("native.runtime_missing")]
    Missing,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub fn executable(root: &Path, name: &str) -> Result<PathBuf, Error> {
    let filename = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    };
    for sub in ["", "bin", "Release", "build/bin", "build/bin/Release"] {
        let candidate = root.join(sub).join(&filename);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(Error::Missing)
}

/// Universal macOS bundles carry a native worker set for each architecture.
pub fn runtime_directory(resources: &Path, name: &str) -> PathBuf {
    let root = resources.join("runtimes");
    let native = root.join(std::env::consts::ARCH).join(name);
    if native.is_dir() {
        native
    } else {
        root.join(name)
    }
}

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

pub fn run(
    command: &mut Command,
    input: Option<&[u8]>,
    output: Option<&Path>,
    token: &Cancellation,
    timeout: Duration,
) -> Result<(), Error> {
    if is_cancelled(token) {
        return Err(Error::Cancelled);
    }
    command
        .stdin(if let Some(input) = input {
            // A worker that stops reading must not block cancellation in write_all.
            let mut file = tempfile::tempfile()?;
            file.write_all(input)?;
            file.rewind()?;
            Stdio::from(file)
        } else {
            Stdio::null()
        })
        .stderr(Stdio::null());
    command.stdout(if let Some(path) = output {
        Stdio::from(File::create(path)?)
    } else {
        Stdio::null()
    });
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut process = Process(command.spawn()?);
    #[cfg(windows)]
    let _job = windows_job::Job::attach(&process.0)?;
    let started = Instant::now();
    loop {
        if is_cancelled(token) {
            return Err(Error::Cancelled);
        }
        if started.elapsed() > timeout {
            return Err(Error::TimedOut);
        }
        if let Some(status) = process.0.try_wait()? {
            return if status.success() {
                Ok(())
            } else {
                Err(Error::WorkerFailed)
            };
        }
        thread::sleep(Duration::from_millis(30));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_uses_native_architecture_when_bundled() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        assert_eq!(
            runtime_directory(root, "piper"),
            root.join("runtimes/piper")
        );
        let native = root
            .join("runtimes")
            .join(std::env::consts::ARCH)
            .join("piper");
        std::fs::create_dir_all(&native).unwrap();
        assert_eq!(runtime_directory(root, "piper"), native);
        assert_eq!(
            runtime_directory(root, "whisper"),
            root.join("runtimes/whisper")
        );
    }
    fn sleeper() -> Command {
        #[cfg(windows)]
        {
            let mut command = Command::new("ping");
            command.args(["-n", "30", "127.0.0.1"]);
            command
        }
        #[cfg(not(windows))]
        {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        }
    }
    #[test]
    fn hung_workers_can_be_cancelled_and_time_out_even_without_reading_stdin() {
        let token = cancellation();
        let other = token.clone();
        let cancel_thread = thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            cancel(&other);
        });
        let start = Instant::now();
        assert!(matches!(
            run(
                &mut sleeper(),
                Some(&[0; 20_000]),
                None,
                &token,
                Duration::from_secs(5)
            ),
            Err(Error::Cancelled)
        ));
        cancel_thread.join().unwrap();
        assert!(matches!(
            run(
                &mut sleeper(),
                None,
                None,
                &cancellation(),
                Duration::from_millis(50)
            ),
            Err(Error::TimedOut)
        ));
        assert!(start.elapsed() < Duration::from_secs(3));
    }
}

#[cfg(windows)]
mod windows_job {
    use super::*;
    use std::{mem, os::windows::io::AsRawHandle, ptr};
    use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
    pub struct Job(windows_sys::Win32::Foundation::HANDLE);
    impl Job {
        pub fn attach(child: &Child) -> Result<Self, std::io::Error> {
            // The job owns no child memory. Closing its handle terminates workers after a parent crash.
            unsafe {
                let handle = CreateJobObjectW(ptr::null(), ptr::null());
                if handle.is_null() {
                    return Err(std::io::Error::last_os_error());
                }
                let job = Self(handle);
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    mem::size_of_val(&info) as u32,
                ) == 0
                    || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(job)
            }
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}
