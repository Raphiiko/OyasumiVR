use crate::{exit, log, paths, spawn, verify};
use oyasumivr_shared::handshake::Handshake;
use std::path::Path;

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

    // the signature names the staged directory
    let id = match verify::signature_id(&signature) {
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

    let Ok(staged_dir) = paths::staged_dir(&id) else {
        log("[run] could not resolve the staged directory");
        return exit::STAGING_FAILED;
    };
    let staged_exe = staged_dir.join(paths::SIDECAR_EXE);

    if !staged_exe.is_file() {
        // verify the source, which the user can write, before any of it reaches Program Files
        if let Err(e) = verify::verify(source, &signature) {
            log(&format!("[run] refusing {}: {e}", source.display()));
            return exit::SIGNATURE_REJECTED;
        }
        if let Err(e) = stage(source, &signature, &staged_dir, &staged_exe) {
            log(&format!("[run] cannot stage into {}: {e}", staged_dir.display()));
            return exit::STAGING_FAILED;
        }
        log(&format!("[run] staged a new sidecar as {id}"));
        collect_old_staged(&id);
    }

    // already verified when it was staged, into a directory only administrators can write
    match spawn::start(&staged_exe, &staged_dir) {
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

/// Writes to a temporary directory and renames it into place, so nothing reads a partial copy.
fn stage(
    source: &Path,
    signature: &Path,
    staged_dir: &Path,
    staged_exe: &Path,
) -> std::io::Result<()> {
    let pending = staged_dir.with_extension("pending");
    let _ = std::fs::remove_dir_all(&pending);
    std::fs::create_dir_all(&pending)?;
    std::fs::copy(source, pending.join(paths::SIDECAR_EXE))?;
    std::fs::copy(
        signature,
        pending.join(format!("{}.minisig", paths::SIDECAR_EXE)),
    )?;
    match std::fs::rename(&pending, staged_dir) {
        Ok(()) => Ok(()),
        // another instance won the race, with the same bytes
        Err(_) if staged_exe.is_file() => {
            let _ = std::fs::remove_dir_all(&pending);
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Best effort. A directory in use survives and is collected on a later launch.
fn collect_old_staged(keep: &str) {
    let Ok(root) = paths::staged_root() else { return };
    let Ok(entries) = std::fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy() == keep {
            continue;
        }
        let _ = std::fs::remove_dir_all(entry.path());
    }
}
