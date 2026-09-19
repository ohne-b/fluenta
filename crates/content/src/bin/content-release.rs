use fluenta_content::release::{decode_key, hex, publish, verify_unpack};
use rand::RngCore;
use std::{
    fs::{self, File},
    io::Write,
    path::Path,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice(){
        ["keygen",private,public]=>{
            let mut bytes=[0;32];rand::rng().fill_bytes(&mut bytes);let key=ed25519_dalek::SigningKey::from_bytes(&bytes);
            let mut secret=File::create_new(private)?;
            #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;secret.set_permissions(fs::Permissions::from_mode(0o600))?;}
            secret.write_all(hex(&key.to_bytes()).as_bytes())?;secret.sync_all()?;
            File::create_new(public)?.write_all(hex(&key.verifying_key().to_bytes()).as_bytes())?;
            println!("Created signing key and public key. Keep the private file out of source control.");
        }
        ["publish",compiled,output,sequence,key]=>{
            let release=publish(Path::new(compiled),Path::new(output),sequence.parse()?,&decode_key(&fs::read_to_string(key)?)?)?;
            println!("Signed release {} with {} course packs: {output}",release.sequence,release.files.len());
        }
        ["verify",archive,public]=>{
            let staging=tempfile::tempdir()?;let release=verify_unpack(Path::new(archive),staging.path(),&decode_key(&fs::read_to_string(public)?)?)?;
            println!("Verified release {} ({} packs).",release.sequence,release.files.len());
        }
        _=>return Err("Usage: content-release keygen PRIVATE PUBLIC | publish COMPILED OUTPUT SEQUENCE PRIVATE | verify ARCHIVE PUBLIC".into()),
    }
    Ok(())
}
