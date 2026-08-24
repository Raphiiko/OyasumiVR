use crate::{exit, log, paths, spawn, verify};
use oyasumivr_shared::handshake::Handshake;
use std::io::{Error, ErrorKind};
use std::path::{Path, PathBuf};

pub fn run() -> u8 {
    let handshake = match Handshake::read() {
        Ok(handshake) => handshake,
        Err(e) => {
            log(&format!("[run] no usable handshake: {e}"));
            return exit::NO_HANDSHAKE;
        }
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

    let Ok(candidate_dir) = paths::staged_dir(&candidate) else {
        log("[run] could not resolve the staged directory");
        return exit::STAGING_FAILED;
    };

    let staged_dir = if candidate_dir.join(paths::SIDECAR_EXE).is_file() {
        candidate_dir
    } else {
        match stage(source, &signature) {
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
    collect_old_staged(&staged_dir);

    // forwarded because the task cannot pass arguments, by design
    let arguments = format!(
        "--core-grpc-port={} --core-pid={}",
        handshake.core_grpc_port, handshake.core_pid
    );

    // verified while already inside a directory only administrators can write
    match spawn::start(&staged_exe, &staged_dir, &arguments) {
        Ok(pid) => {
            log(&format!("[run] started the sidecar as pid {pid}"));
            exit::OK
        }
        Err(e) => {
            log(&format!("[run] cannot start {}: {e}", staged_exe.display()));
            exit::SPAWN_FAILED
        }
    }
}

/// Copies the sidecar into Program Files, verifies it there, and returns the directory it landed
/// in. Returns `InvalidData` when the signature is rejected.
fn stage(source: &Path, signature: &Path) -> std::io::Result<PathBuf> {
    let root = paths::staged_root()?;
    std::fs::create_dir_all(&root)?;
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
    let target = paths::staged_dir(&id)?;
    match std::fs::rename(&pending, &target) {
        Ok(()) => Ok(target),
        // another instance won the race, with bytes that passed the same check
        Err(_) if target.join(paths::SIDECAR_EXE).is_file() => {
            let _ = std::fs::remove_dir_all(&pending);
            Ok(target)
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&pending);
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

/// Best effort. A directory in use survives and is collected on a later launch.
fn collect_old_staged(keep: &Path) {
    let Ok(root) = paths::staged_root() else { return };
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // leave another instance's half-filled directory alone
        if path == keep || entry.file_name().to_string_lossy().starts_with(".pending-") {
            continue;
        }
        let _ = std::fs::remove_dir_all(path);
    }
}
