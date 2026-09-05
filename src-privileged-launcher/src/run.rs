use crate::{exit, log, paths, spawn, verify};
use oyasumivr_shared::handshake::Handshake;
use std::io::{Error, ErrorKind};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// A staged directory younger than this is left alone. It may belong to another launcher that is
/// still filling it, or to another account that is about to start the sidecar from it.
const COLLECT_AFTER: Duration = Duration::from_secs(60 * 60);

pub fn run() -> u8 {
    let handshake = match Handshake::read() {
        Ok(handshake) => handshake,
        Err(e) => {
            log(&format!("[run] no usable handshake: {e}"));
            return exit::NO_HANDSHAKE;
        }
    };

    let Ok(root) = paths::staged_root() else {
        log("[run] could not resolve the staged directory");
        return exit::STAGING_FAILED;
    };

    let source = handshake.sidecar_path.as_path();
    let signature = verify::signature_path(source);

    // only says which staged directory to look for; the copy there is what gets verified
    let candidate = match verify::signature_id(&signature) {
        Ok(id) if !id.is_empty() => id,
        Ok(_) => {
            log("[run] the signature file carries no signature");
            return exit::SIGNATURE_REJECTED;
        }
        Err(e) => {
            log(&format!("[run] cannot read {}: {e}", signature.display()));
            return exit::SIGNATURE_REJECTED;
        }
    };

    let candidate_dir = root.join(&candidate);
    let staged_dir = if is_filled(&candidate_dir) {
        candidate_dir
    } else {
        match stage(&root, source, &signature) {
            Ok(dir) => {
                log(&format!(
                    "[run] staged a new sidecar as {}",
                    dir.file_name().unwrap_or_default().to_string_lossy()
                ));
                dir
            }
            Err(e) if e.kind() == ErrorKind::InvalidData => {
                log(&format!("[run] refusing {}: {e}", source.display()));
                return exit::SIGNATURE_REJECTED;
            }
            Err(e) => {
                log(&format!("[run] cannot stage {}: {e}", source.display()));
                return exit::STAGING_FAILED;
            }
        }
    };

    let staged_exe = staged_dir.join(paths::SIDECAR_EXE);
    // Checked again here, whether this launch staged the copy or found it. This is the last moment
    // before the bytes run elevated, and the directory name alone is no evidence about them.
    if let Err(e) = verify::verify(&staged_exe, &verify::signature_path(&staged_exe)) {
        log(&format!("[run] discarding {}: {e}", staged_dir.display()));
        // Removed, or the same damaged copy is picked again on every later launch.
        let _ = std::fs::remove_dir_all(&staged_dir);
        return exit::STAGING_FAILED;
    }

    // forwarded because the task cannot pass arguments, by design
    let mut arguments = format!(
        "--core-grpc-port={} --core-pid={}",
        handshake.core_grpc_port, handshake.core_pid
    );
    if handshake.error_reporting_enabled {
        arguments.push_str(" --error-reporting-enabled");
    }

    let outcome = match spawn::start(&staged_exe, &staged_dir, &arguments) {
        Ok(pid) => {
            log(&format!("[run] started the sidecar as pid {pid}"));
            exit::OK
        }
        Err(e) => {
            log(&format!("[run] cannot start {}: {e}", staged_exe.display()));
            exit::SPAWN_FAILED
        }
    };

    // After the spawn: another account's launcher shares this root, and collecting first let it
    // delete a directory this launch had already verified and was about to run from.
    collect_old_staged(&root, &staged_dir);
    outcome
}

/// Both halves present. A directory holding only one of them lost a race or a disk.
fn is_filled(dir: &Path) -> bool {
    let exe = dir.join(paths::SIDECAR_EXE);
    exe.is_file() && verify::signature_path(&exe).is_file()
}

/// Copies the sidecar into Program Files, verifies it there, and returns the directory it landed
/// in. Returns `InvalidData` when the signature is rejected.
fn stage(root: &Path, source: &Path, signature: &Path) -> std::io::Result<PathBuf> {
    let missing = !root.is_dir();
    std::fs::create_dir_all(root)?;
    if missing {
        // The whole chain may have just been recreated, inheriting permissions we do not want.
        if let Some(privileged) = root.parent() {
            oyasumivr_shared::windows::protect_directory(privileged)?;
        }
        oyasumivr_shared::windows::protect_directory(root)?;
    }
    // one pending directory per launcher process, so concurrent instances cannot collide
    let pending = root.join(format!(".pending-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&pending);
    std::fs::create_dir_all(&pending)?;

    let staged_signature = match fill_and_verify(source, signature, &pending) {
        Ok(path) => path,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&pending);
            return Err(e);
        }
    };

    // named after the signature that was verified, so a directory always matches its contents
    let id = verify::signature_id(&staged_signature)?;
    let target = root.join(id);
    promote(&pending, &target)
}

/// Moves a verified pending directory into place.
fn promote(pending: &Path, target: &Path) -> std::io::Result<PathBuf> {
    // Windows will not rename over an existing directory, so a half-filled one has to go first.
    // Something removed a file from it, or a previous launcher died between the two copies.
    if target.exists() && !is_filled(target) {
        let _ = std::fs::remove_dir_all(target);
    }
    match std::fs::rename(pending, target) {
        Ok(()) => Ok(target.to_path_buf()),
        // another instance won the race, with bytes that passed the same check
        Err(_) if is_filled(target) => {
            let _ = std::fs::remove_dir_all(pending);
            Ok(target.to_path_buf())
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(pending);
            Err(e)
        }
    }
}

fn fill_and_verify(source: &Path, signature: &Path, pending: &Path) -> std::io::Result<PathBuf> {
    let exe = pending.join(paths::SIDECAR_EXE);
    let sig = verify::signature_path(&exe);
    std::fs::copy(source, &exe)?;
    std::fs::copy(signature, &sig)?;
    verify::verify(&exe, &sig).map_err(|e| Error::new(ErrorKind::InvalidData, e.to_string()))?;
    Ok(sig)
}

/// Best effort, and only for directories old enough that nothing can still be starting from them.
/// A directory in use survives and is collected on a later launch.
fn collect_old_staged(root: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep {
            continue;
        }
        let old_enough = entry
            .metadata()
            .and_then(|m| m.modified())
            .and_then(|m| now.duration_since(m).map_err(std::io::Error::other))
            .map(|age| age >= COLLECT_AFTER)
            .unwrap_or(false);
        if !old_enough {
            continue;
        }
        let _ = std::fs::remove_dir_all(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::UNIX_EPOCH;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes an exe and a signature file, without either being a real pair.
    fn fill(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        let exe = dir.join(paths::SIDECAR_EXE);
        std::fs::write(&exe, b"pretend this is a sidecar").unwrap();
        std::fs::write(verify::signature_path(&exe), b"pretend this is a signature").unwrap();
    }

    /// A directory handle needs backup semantics, and changing its timestamp needs
    /// FILE_WRITE_ATTRIBUTES.
    fn age(path: &Path, seconds: u64) {
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

        let when = UNIX_EPOCH + Duration::from_secs(1_700_000_000 - seconds);
        std::fs::OpenOptions::new()
            .access_mode(FILE_WRITE_ATTRIBUTES)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(path)
            .unwrap()
            .set_modified(when)
            .unwrap();
    }

    #[test]
    fn a_directory_counts_as_filled_only_with_both_halves() {
        let root = scratch("oyasumi-run-filled");
        let dir = root.join("abc");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!is_filled(&dir), "an empty directory is not usable");

        let exe = dir.join(paths::SIDECAR_EXE);
        std::fs::write(&exe, b"x").unwrap();
        assert!(!is_filled(&dir), "an exe without a signature is not usable");

        std::fs::write(verify::signature_path(&exe), b"y").unwrap();
        assert!(is_filled(&dir));
    }

    #[test]
    fn collection_keeps_the_current_directory_and_anything_recent() {
        let root = scratch("oyasumi-run-collect");
        let keep = root.join("keep");
        let recent = root.join("recent");
        let old = root.join("old");
        let pending = root.join(".pending-4242");
        for dir in [&keep, &recent, &old, &pending] {
            fill(dir);
        }
        age(&old, COLLECT_AFTER.as_secs() + 60);
        age(&pending, COLLECT_AFTER.as_secs() + 60);

        collect_old_staged(&root, &keep);

        assert!(keep.is_dir(), "the directory in use must survive");
        assert!(recent.is_dir(), "a recent directory may still be starting");
        assert!(!old.exists(), "an old directory must be collected");
        assert!(
            !pending.exists(),
            "an abandoned pending directory must be collected too"
        );
    }

    #[test]
    fn collection_survives_a_missing_root() {
        collect_old_staged(
            &std::env::temp_dir().join("oyasumi-run-does-not-exist"),
            Path::new("x"),
        );
    }

    #[test]
    fn promotion_moves_a_pending_directory_into_place() {
        let root = scratch("oyasumi-run-promote-new");
        let pending = root.join(".pending-1");
        fill(&pending);
        let target = root.join("abc");

        let promoted = promote(&pending, &target).expect("must promote");

        assert_eq!(promoted, target);
        assert!(is_filled(&target));
        assert!(!pending.exists(), "the pending directory must be gone");
    }

    #[test]
    fn promotion_replaces_a_half_filled_target() {
        let root = scratch("oyasumi-run-promote-damaged");
        let pending = root.join(".pending-1");
        fill(&pending);
        // what an antivirus quarantine leaves behind: the signature without the exe
        let target = root.join("abc");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(
            verify::signature_path(&target.join(paths::SIDECAR_EXE)),
            b"orphaned",
        )
        .unwrap();

        promote(&pending, &target).expect("must replace a target that is not usable");

        assert!(is_filled(&target));
        assert_eq!(
            std::fs::read(target.join(paths::SIDECAR_EXE)).unwrap(),
            b"pretend this is a sidecar"
        );
    }

    #[test]
    fn promotion_keeps_a_target_another_launcher_already_filled() {
        let root = scratch("oyasumi-run-promote-race");
        let pending = root.join(".pending-1");
        fill(&pending);
        let target = root.join("abc");
        fill(&target);
        std::fs::write(target.join(paths::SIDECAR_EXE), b"the winner").unwrap();

        let promoted = promote(&pending, &target).expect("must accept the winner");

        assert_eq!(promoted, target);
        assert_eq!(
            std::fs::read(target.join(paths::SIDECAR_EXE)).unwrap(),
            b"the winner",
            "the copy that got there first passed the same check"
        );
        assert!(!pending.exists());
    }

    #[test]
    fn staging_refuses_a_sidecar_whose_signature_does_not_match() {
        let root = scratch("oyasumi-run-stage-bad");
        let source_dir = scratch("oyasumi-run-stage-bad-src");
        let source = source_dir.join(paths::SIDECAR_EXE);
        std::fs::write(&source, b"not the signed sidecar").unwrap();
        let signature = verify::signature_path(&source);
        std::fs::write(
            &signature,
            "untrusted comment: x\nRURVwFT5RoqL7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\ntrusted comment: oyasumivr-elevated-sidecar\nAAAA==\n",
        )
        .unwrap();

        let error = stage(&root, &source, &signature).expect_err("must refuse");
        assert_eq!(error.kind(), ErrorKind::InvalidData, "{error}");
        assert!(
            std::fs::read_dir(&root).unwrap().next().is_none(),
            "a refused stage must leave nothing behind"
        );
    }
}
