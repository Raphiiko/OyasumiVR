use std::{path::Path, process::Command};

use codesigned::CodeSigned;
use log::{error, info, warn};

pub fn set_afterburner_profile(exe_path: String, index: i8) -> Result<String, String> {
    // We allow setting profile 0 for testing execution without actually changing the profile.
    if !(0..=5).contains(&index) {
        warn!(
            "[Afterburner] The provided profile index was invalid ({})",
            index
        );
        return Err(String::from("INVALID_PROFILE_INDEX"));
    };
    // Verify executable existing
    let path = Path::new(exe_path.as_str());
    if !path.exists() || !path.is_file() {
        warn!(
            "[Afterburner] MSI Afterburner could not be found at the provided location ({})",
            exe_path.clone()
        );
        return Err(String::from("EXE_NOT_FOUND"));
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
            return Err(String::from("EXE_CANNOT_EXECUTE"));
        }
    };
    Ok(String::from("PROFILE_SET"))
}

fn verify_afterburner_signature(exe_path: String) -> Result<String, String> {
    let signature = match CodeSigned::new(exe_path.clone()) {
        Ok(signature) => signature,
        Err(_) => {
            warn!("[Afterburner] Executable at the path provided ({}) could not be verified with a signature.", exe_path);
            return Err(String::from("EXE_UNVERIFIABLE"));
        }
    };
    if !signature.is_signed() {
        warn!("[Afterburner] Executable at the path provided ({}) does not have a signature and could not be verified.", exe_path);
        return Err(String::from("EXE_NOT_SIGNED"));
    }
    if !signature.is_embedded() {
        warn!("[Afterburner] Signature found for the executable at the path provided ({}) is not permitted: Non-embedded signature.", exe_path);
        return Err(String::from("EXE_SIGNATURE_DISALLOWED_NON_EMBEDDED"));
    }
    // Check for valid issuer and subject
    let issuer_name = match signature.issuer_name {
        Some(issuer_name) => issuer_name,
        None => {
            warn!("[Afterburner] Signature found for the executable at the path provided ({}) is not permitted: No issuer found.", exe_path);
            return Err(String::from("EXE_SIGNATURE_DISALLOWED_NO_ISSUER"));
        }
    };
    let subject_name = match signature.subject_name {
        Some(subject_name) => subject_name,
        None => {
            warn!("[Afterburner] Signature found for the executable at the path provided ({}) is not permitted: No subject found.", exe_path);
            return Err(String::from("EXE_SIGNATURE_DISALLOWED_NO_SUBJECT"));
        }
    };
    let issuer_and_subject = (issuer_name.as_str(), subject_name.as_str());
    let allowed_issuers_and_subjects = vec![
        (
            "GlobalSign Extended Validation CodeSigning CA - SHA256 - G3, GlobalSign nv-sa, BE",
            "MICRO-STAR INTERNATIONAL CO., LTD.",
        ),
        (
            "GlobalSign GCC R45 EV CodeSigning CA 2020, GlobalSign nv-sa, BE",
            "MICRO-STAR INTERNATIONAL CO., LTD.",
        ),
    ];
    if !allowed_issuers_and_subjects.contains(&issuer_and_subject) {
        warn!("[Afterburner] Signature found for the executable at the path provided ({}) is not permitted (issuer_name:[{}], subject_name:[{}])", exe_path, issuer_name, subject_name);
        return Err(String::from("EXE_SIGNATURE_DISALLOWED_NO_MATCH"));
    }
    info!("[Afterburner] Successfully verified signature for the executable at the path provided({}).", exe_path);
    Ok(String::from("EXE_VERIFIED"))
}
