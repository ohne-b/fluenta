use super::*;

impl Store {
    /// One complete SQLite snapshot on the first launch each UTC day; keep seven days.
    /// Course packs and recordings are immutable and remain beside the live database.
    pub fn daily_snapshot(&self, now: i64) -> Result<()> {
        let directory = self.directory.join("snapshots");
        fs::create_dir_all(&directory)?;
        let destination = directory.join(format!("day-{:016}.sqlite", now.max(0) / 86_400_000));
        if destination.exists() {
            return Ok(());
        }
        let staging = tempfile::tempdir_in(&directory)?;
        let file = staging.path().join("snapshot.sqlite");
        self.backup(&file)?;
        Self::validate_backup(&file)?;
        fs::OpenOptions::new().write(true).open(&file)?.sync_all()?;
        fs::rename(file, destination)?;
        let mut snapshots = snapshot_paths(&self.directory)?;
        snapshots.reverse();
        for old in snapshots.into_iter().skip(7) {
            fs::remove_file(old)?;
        }
        Ok(())
    }
    pub fn latest_snapshot(directory: &Path) -> Result<Option<PathBuf>> {
        for path in snapshot_paths(directory)?.into_iter().rev() {
            if Self::validate_backup(&path).is_ok() {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }
    /// Called with all database connections closed, after the learner chooses recovery.
    /// Preserve the damaged database and its WAL before replacing anything.
    pub fn recover_snapshot(directory: &Path, snapshot: &Path) -> Result<PathBuf> {
        Self::validate_backup(snapshot)?;
        let archive = directory.join(format!("recovery-{}", new_id()));
        fs::create_dir(&archive)?;
        let mut replacement = tempfile::NamedTempFile::new_in(directory)?;
        std::io::copy(&mut fs::File::open(snapshot)?, replacement.as_file_mut())?;
        replacement.as_file().sync_all()?;
        for name in ["student.sqlite", "student.sqlite-wal", "student.sqlite-shm"] {
            let file = directory.join(name);
            if file.exists() {
                fs::copy(file, archive.join(name))?;
                fs::OpenOptions::new()
                    .write(true)
                    .open(archive.join(name))?
                    .sync_all()?;
            }
        }
        for name in ["student.sqlite-wal", "student.sqlite-shm"] {
            let file = directory.join(name);
            if file.exists() {
                fs::remove_file(file)?;
            }
        }
        replacement
            .persist(directory.join("student.sqlite"))
            .map_err(|e| e.error)?;
        Ok(archive)
    }
}

fn snapshot_paths(directory: &Path) -> Result<Vec<PathBuf>> {
    let directory = directory.join("snapshots");
    if !directory.exists() {
        return Ok(vec![]);
    }
    let mut paths = vec![];
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if entry.file_type()?.is_file()
            && name
                .strip_prefix("day-")
                .and_then(|s| s.strip_suffix(".sqlite"))
                .is_some_and(|s| s.len() == 16 && s.bytes().all(|c| c.is_ascii_digit()))
        {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_preserves_damaged_data_and_restores_a_valid_daily_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).unwrap();
        let mut settings = store.settings().unwrap();
        settings.daily_minutes = 35;
        store.save_settings(settings).unwrap();
        for day in 1..=9 {
            store.daily_snapshot(day * 86_400_000).unwrap();
        }
        assert_eq!(snapshot_paths(directory.path()).unwrap().len(), 7);
        drop(store);
        fs::write(directory.path().join("student.sqlite"), "damaged original").unwrap();
        assert!(Store::open(directory.path()).is_err());
        let snapshot = Store::latest_snapshot(directory.path()).unwrap().unwrap();
        let preserved = Store::recover_snapshot(directory.path(), &snapshot).unwrap();
        assert_eq!(
            fs::read_to_string(preserved.join("student.sqlite")).unwrap(),
            "damaged original"
        );
        assert_eq!(
            Store::open(directory.path())
                .unwrap()
                .settings()
                .unwrap()
                .daily_minutes,
            35
        );
    }
}
