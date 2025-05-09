use std::{path::Path, process::Command};

use codesigned::CodeSigned;
use log::{error, info, warn};

use crate::Models::SetMsiAfterburnerProfileError;

pub fn set_afterburner_profile(
    exe_path: String,
    index: u32,
) -> Result<(), SetMsiAfterburnerProfileError> {
    // We allow setting profile 0 for testing execution without actually changing the profile.
    if !(0..=5).contains(&index) {
        warn!(
            "[Afterburner] The provided profile index was invalid ({})",
            index
        );
        return Err(SetMsiAfterburnerProfileError::InvalidProfileIndex);
    };
    // Verify executable existing
    let path = Path::new(exe_path.as_str());
    if !path.exists() || !path.is_file() {
        warn!(
            "[Afterburner] MSI Afterburner could not be found at the provided location ({})",
            exe_path.clone()
        );
        return Err(SetMsiAfterburnerProfileError::ExeNotFound);
    }
    // Verify executable signature
    let verification_result = verify_afterburner_signature(exe_path.clone());
    if verification_result.is_err() {
        return Err(verification_result.err().unwrap());
    }
    // Determine parameters
    let param = if index > 0 {
        format!("-Profile{index}")
    } else {
        String::from("")
    };
    // Run executable
    let _ = match Command::new(exe_path).args([param]).spawn() {
        Ok(output) => output,
        Err(e) => {
            error!(
                "[Afterburner] Could not run MSI Afterburner (EXE_CANNOT_EXECUTE): {}",
                e
            );
            return Err(SetMsiAfterburnerProfileError::ExeNotFound);
        }
    };
    Ok(())
}

fn verify_afterburner_signature(exe_path: String) -> Result<(), SetMsiAfterburnerProfileError> {
    let signature = match CodeSigned::new(exe_path.clone()) {
        Ok(signature) => signature,
        Err(_) => {
            warn!("[Afterburner] Executable at the path provided ({}) could not be verified with a signature.", exe_path);
            return Err(SetMsiAfterburnerProfileError::ExeUnverifiable);
        }
    };
    if !signature.is_signed() {
        warn!("[Afterburner] Executable at the path provided ({}) does not have a signature and could not be verified.", exe_path);
        return Err(SetMsiAfterburnerProfileError::ExeNotSigned);
    }
    if !signature.is_embedded() {
        warn!("[Afterburner] Signature found for the executable at the path provided ({}) is not permitted: Non-embedded signature.", exe_path);
        return Err(SetMsiAfterburnerProfileError::ExeSignatureDisallowedNonEmbedded);
    }
    // Check for valid issuer and subject
    let issuer_name = match signature.issuer_name {
        Some(issuer_name) => issuer_name,
        None => {
            warn!("[Afterburner] Signature found for the executable at the path provided ({}) is not permitted: No issuer found.", exe_path);
            return Err(SetMsiAfterburnerProfileError::ExeSignatureDisallowedNoIssuer);
        }
    };
    let subject_name = match signature.subject_name {
        Some(subject_name) => subject_name,
        None => {
            warn!("[Afterburner] Signature found for the executable at the path provided ({}) is not permitted: No subject found.", exe_path);
            return Err(SetMsiAfterburnerProfileError::ExeSignatureDisallowedNoSubject);
        }
    };
    let issuer_and_subject = (issuer_name.as_str(), subject_name.as_str());
    let allowed_issuers_and_subjects = [(
            "GlobalSign Extended Validation CodeSigning CA - SHA256 - G3, GlobalSign nv-sa, BE",
            "MICRO-STAR INTERNATIONAL CO., LTD.",
        ),
        (
            "GlobalSign GCC R45 EV CodeSigning CA 2020, GlobalSign nv-sa, BE",
            "MICRO-STAR INTERNATIONAL CO., LTD.",
        )];
    if !allowed_issuers_and_subjects.contains(&issuer_and_subject) {
        warn!("[Afterburner] Signature found for the executable at the path provided ({}) is not permitted (issuer_name:[{}], subject_name:[{}])", exe_path, issuer_name, subject_name);
        return Err(SetMsiAfterburnerProfileError::ExeSignatureDisallowedNoMatch);
    }
    info!("[Afterburner] Successfully verified signature for the executable at the path provided({}).", exe_path);
    Ok(())
}
