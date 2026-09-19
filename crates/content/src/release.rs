//! Signed, immutable course releases. An archive is authenticated before SQLite opens it.
use crate::{Catalog, Error, Result, open_readonly};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use fluenta_contracts::{Course, Id};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

pub const MAX_PACK_BYTES: u64 = 256 * 1024 * 1024;
const MAX_RELEASE_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Release {
    pub format: u32,
    pub sequence: u64,
    pub files: Vec<ReleasedPack>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleasedPack {
    pub name: String,
    pub sha256: String,
    pub bytes: u64,
    pub release_id: Id,
    pub course: Course,
}

fn invalid(message: &str) -> Error {
    Error::Invalid(format!("release: {message}"))
}
pub fn decode_key<const N: usize>(text: &str) -> Result<[u8; N]> {
    let text = text.trim();
    if text.len() != N * 2 {
        return Err(invalid("invalid key length"));
    }
    let mut result = [0; N];
    for (index, pair) in text.as_bytes().chunks_exact(2).enumerate() {
        let pair = std::str::from_utf8(pair).map_err(|_| invalid("invalid key encoding"))?;
        result[index] =
            u8::from_str_radix(pair, 16).map_err(|_| invalid("invalid key encoding"))?;
    }
    Ok(result)
}
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn digest(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Only generated files named by the compiler are published; stale revisions stay out.
pub fn publish(
    directory: &Path,
    destination: &Path,
    sequence: u64,
    secret: &[u8; 32],
) -> Result<Release> {
    if sequence == 0 {
        return Err(invalid("sequence must be positive"));
    }
    let selected: Vec<String> =
        serde_json::from_slice(&fs::read(directory.join("active-releases.json"))?)?;
    let catalog = Catalog::open(directory)?;
    let mut files = Vec::new();
    for pack in &catalog.packs {
        let name = pack
            .path
            .file_name()
            .ok_or_else(|| invalid("missing filename"))?
            .to_string_lossy()
            .into_owned();
        if selected.contains(&name) {
            files.push(ReleasedPack {
                name,
                sha256: digest(&pack.path)?,
                bytes: pack.path.metadata()?.len(),
                release_id: pack.release_id.clone(),
                course: pack.course.clone(),
            });
        }
    }
    let release = Release {
        format: 1,
        sequence,
        files,
    };
    validate_manifest(&release)?;
    let manifest = serde_json::to_vec(&release)?;
    let signature = SigningKey::from_bytes(secret).sign(&manifest);
    let mut temporary =
        tempfile::NamedTempFile::new_in(destination.parent().unwrap_or(Path::new(".")))?;
    let mut archive = ZipWriter::new(temporary.as_file_mut());
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    archive.start_file("release.json", options)?;
    archive.write_all(&manifest)?;
    archive.start_file("release.sig", options)?;
    archive.write_all(&signature.to_bytes())?;
    for file in &release.files {
        archive.start_file(&file.name, options)?;
        std::io::copy(&mut File::open(directory.join(&file.name))?, &mut archive)?;
    }
    archive.finish()?.sync_all()?;
    temporary
        .persist_noclobber(destination)
        .map_err(|e| e.error)?;
    Ok(release)
}

fn validate_manifest(release: &Release) -> Result<()> {
    if release.format != 1
        || release.sequence == 0
        || release.files.is_empty()
        || release.files.len() > 32
    {
        return Err(invalid("unsupported or empty manifest"));
    }
    let mut names = BTreeSet::new();
    let mut courses = BTreeSet::new();
    let mut total = 0;
    for file in &release.files {
        if file.name != format!("{}.sqlite", file.release_id)
            || !file
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            || !names.insert(&file.name)
            || !courses.insert((
                file.course.content.id.as_str(),
                file.course.source_language.code(),
            ))
        {
            return Err(invalid("duplicate or invalid filename/course"));
        }
        if file.bytes == 0 || file.bytes > MAX_PACK_BYTES || decode_key::<32>(&file.sha256).is_err()
        {
            return Err(invalid("invalid pack size or hash"));
        }
        total += file.bytes;
    }
    if total > MAX_RELEASE_BYTES {
        return Err(invalid("release exceeds 1 GiB"));
    }
    Ok(())
}

fn read_entry(archive: &mut ZipArchive<File>, name: &str, limit: u64) -> Result<Vec<u8>> {
    let mut entry = archive.by_name(name)?;
    if entry.is_dir() || entry.is_symlink() || entry.size() > limit {
        return Err(invalid("invalid entry"));
    }
    let expected = entry.size();
    let mut bytes = Vec::new();
    entry.by_ref().take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 != expected {
        return Err(invalid("entry size mismatch"));
    }
    Ok(bytes)
}

/// `destination` must be a fresh staging directory. Never writes a live pack in place.
pub fn verify_unpack(source: &Path, destination: &Path, public: &[u8; 32]) -> Result<Release> {
    let mut archive = ZipArchive::new(File::open(source)?)?;
    if archive.len() > 34 {
        return Err(invalid("too many entries"));
    }
    let manifest = read_entry(&mut archive, "release.json", 256 * 1024)?;
    let signature = read_entry(&mut archive, "release.sig", 64)?;
    let public = VerifyingKey::from_bytes(public).map_err(|_| invalid("invalid public key"))?;
    public
        .verify_strict(
            &manifest,
            &Signature::try_from(signature.as_slice()).map_err(|_| invalid("invalid signature"))?,
        )
        .map_err(|_| invalid("untrusted signature"))?;
    let release: Release = serde_json::from_slice(&manifest)?;
    validate_manifest(&release)?;
    let expected: BTreeSet<_> = release
        .files
        .iter()
        .map(|f| f.name.as_str())
        .chain(["release.json", "release.sig"])
        .collect();
    if archive.len() != expected.len() {
        return Err(invalid("duplicate or extra entries"));
    }
    let mut seen = BTreeSet::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index)?;
        if !expected.contains(file.name()) || !seen.insert(file.name().to_owned()) {
            return Err(invalid("unexpected archive entry"));
        }
    }
    fs::create_dir_all(destination)?;
    for file in &release.files {
        let bytes = read_entry(&mut archive, &file.name, file.bytes)?;
        if bytes.len() as u64 != file.bytes || hex(&Sha256::digest(&bytes)) != file.sha256 {
            return Err(invalid("pack checksum mismatch"));
        }
        let path = destination.join(&file.name);
        let mut output = File::create_new(&path)?;
        output.write_all(&bytes)?;
        output.sync_all()?;
    }
    let catalog = Catalog::open(destination)?;
    for file in &release.files {
        let pack = catalog.pack(&file.release_id)?;
        if serde_json::to_value(&pack.course)? != serde_json::to_value(&file.course)? {
            return Err(invalid("course metadata mismatch"));
        }
        let db = open_readonly(&pack.path)?;
        let integrity: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if integrity != "ok" || db.prepare("PRAGMA foreign_key_check")?.exists([])? {
            return Err(invalid("invalid course database"));
        }
        let _: Vec<String> = db
            .prepare("SELECT payload FROM unit_overviews")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
    }
    Ok(release)
}

/// Reusing a stable ID/revision with different data would corrupt pinned sessions.
pub fn check_revision_compatibility(previous: &Path, next: &Path) -> Result<()> {
    let old = open_readonly(previous)?;
    let new = open_readonly(next)?;
    let mut query = new.prepare("SELECT id,revision,kind,payload FROM entities")?;
    for row in query.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, u32>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
        ))
    })? {
        let (id, revision, kind, payload) = row?;
        use rusqlite::OptionalExtension;
        let prior: Option<(String, String)> = old
            .query_row(
                "SELECT kind,payload FROM entities WHERE id=?1 AND revision=?2",
                rusqlite::params![id, revision],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((old_kind, old_payload)) = prior
            && (old_kind != kind
                || serde_json::from_str::<serde_json::Value>(&old_payload)?
                    != serde_json::from_str::<serde_json::Value>(&payload)?)
        {
            return Err(invalid(&format!(
                "{id}@{revision} changed without a revision bump"
            )));
        }
    }
    Ok(())
}

pub fn pack_paths(directory: &Path, release: &Release) -> Vec<PathBuf> {
    release
        .files
        .iter()
        .map(|f| directory.join(&f.name))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_release_roundtrip_rejects_wrong_key_extra_entries_and_changed_revisions() {
        let root = tempfile::tempdir().unwrap();
        let compiled = root.path().join("compiled");
        crate::compile_source(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../content/foundation"),
            &compiled,
        )
        .unwrap();
        let path = root.path().join("course.fluentacourse");
        let key = SigningKey::from_bytes(&[13; 32]);
        publish(&compiled, &path, 1, &key.to_bytes()).unwrap();
        assert!(
            verify_unpack(
                &path,
                &root.path().join("wrong"),
                &SigningKey::from_bytes(&[14; 32]).verifying_key().to_bytes()
            )
            .is_err()
        );
        let target = root.path().join("valid");
        let release = verify_unpack(&path, &target, &key.verifying_key().to_bytes()).unwrap();
        assert_eq!(release.files.len(), 8);
        let first = &release.files[0].name;
        check_revision_compatibility(&compiled.join(first), &target.join(first)).unwrap();
        let db = rusqlite::Connection::open(target.join(first)).unwrap();
        db.execute("UPDATE entities SET payload=json_set(payload,'$.searchable',true) WHERE kind='material'",[]).unwrap();
        drop(db);
        assert!(check_revision_compatibility(&compiled.join(first), &target.join(first)).is_err());
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        let mut zip = ZipWriter::new_append(file).unwrap();
        zip.start_file("../escape", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"escape").unwrap();
        zip.finish().unwrap();
        assert!(
            verify_unpack(
                &path,
                &root.path().join("extra"),
                &key.verifying_key().to_bytes()
            )
            .is_err()
        );
    }
}
