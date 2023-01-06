use std::process::Command;

use codesigned::CodeSigned;

pub fn set_afterburner_profile(exe_path: String, index: i8) -> Result<String, String> {
    // We allow setting profile 0 for testing execution without actually changing the profile.
    if (index < 0) || (index > 5) {
        return Err(String::from("INVALID_PROFILE_INDEX"));
    };
    // Verify executable signature
    let verification_result = verify_afterburner_signature(exe_path.clone());
    if verification_result.is_err() {
        return Err(verification_result.err().unwrap());
    }
    // Determine parameters
    let param = if index > 0 {
        format!("-Profile{}", index)
    } else {
        String::from("")
    };
    // Run executable
    let _ = match Command::new(exe_path).args([param]).spawn() {
        Ok(output) => output,
        Err(_) => {
            return Err(String::from("EXE_CANNOT_EXECUTE"));
        }
    };
    Ok(String::from("PROFILE_SET"))
}

fn verify_afterburner_signature(exe_path: String) -> Result<String, String> {
    let signature = match CodeSigned::new(exe_path) {
        Ok(signature) => signature,
        Err(_) => {
            return Err(String::from("EXE_UNVERIFIABLE"));
        }
    };
    if !signature.is_signed() {
        return Err(String::from("EXE_NOT_SIGNED"));
    }
    if !signature.is_embedded() {
        return Err(String::from("EXE_SIGNATURE_DISALLOWED_NON_EMBEDDED"));
    }
    // Check for valid issuer and subject
    let issuer_name = match signature.issuer_name {
        Some(issuer_name) => issuer_name,
        None => {
            return Err(String::from("EXE_SIGNATURE_DISALLOWED_NO_ISSUER"));
        }
    };
    let subject_name = match signature.subject_name {
        Some(subject_name) => subject_name,
        None => {
            return Err(String::from("EXE_SIGNATURE_DISALLOWED_NO_SUBJECT"));
        }
    };
    let issuer_and_subject = (issuer_name.as_str(), subject_name.as_str());
    let allowed_issuers_and_subjects = vec![(
        "GlobalSign Extended Validation CodeSigning CA - SHA256 - G3, GlobalSign nv-sa, BE",
        "MICRO-STAR INTERNATIONAL CO., LTD.",
    )];
    if !allowed_issuers_and_subjects.contains(&issuer_and_subject) {
        return Err(String::from("EXE_SIGNATURE_DISALLOWED_NO_MATCH"));
    }
    Ok(String::from("EXE_VERIFIED"))
}
