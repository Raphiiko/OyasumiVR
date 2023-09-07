use std::{collections::HashMap, fs::File, process::Command};

use crate::globals::{ASPNET_CORE_VERSION, DOTNET_CORE_VERSION};
use log::{error, info};
use tempfile::Builder;

// Checks if the exact dotnet runtime versions are installed that are required
// Returns <String, String> where the key is the runtime (DOTNETCORE / ASPNETCORE)
// and the value is the version required to be installed
// ERRORS: FAILED_VERSION_CHECK, FAILED_VERSION_LISTING, FAILED_VERSION_PARSING
pub fn check_dotnet_install_required() -> Result<HashMap<String, String>, String> {
    let mut result = HashMap::<String, String>::new();
    let netcore_versions = match get_net_core_versions() {
        Ok(versions) => versions,
        Err(e) => {
            error!("Failed to get .NET Core version: {}", e);
            return Err("FAILED_VERSION_CHECK".into());
        }
    };
    if !netcore_versions.contains(&DOTNET_CORE_VERSION.to_string()) {
        result.insert(
            String::from("DOTNETCORE"),
            String::from(DOTNET_CORE_VERSION),
        );
    }
    let aspnetcore_versions = match get_asp_net_core_versions() {
        Ok(versions) => versions,
        Err(e) => {
            error!("Failed to get ASP.NET Core version: {}", e);
            return Err("FAILED_VERSION_CHECK".into());
        }
    };
    if !aspnetcore_versions.contains(&ASPNET_CORE_VERSION.to_string()) {
        result.insert(
            String::from("ASPNETCORE"),
            String::from(ASPNET_CORE_VERSION),
        );
    }
    Ok(result)
}

pub fn get_net_core_versions() -> Result<Vec<String>, String> {
    get_dotnet_versions("Microsoft.NETCore.App")
}

pub fn get_asp_net_core_versions() -> Result<Vec<String>, String> {
    get_dotnet_versions("Microsoft.AspNetCore.App")
}

fn get_dotnet_versions(runtime: &str) -> Result<Vec<String>, String> {
    let output = match std::process::Command::new("dotnet")
        .arg("--list-runtimes")
        .output()
    {
        Ok(output) => match String::from_utf8(output.stdout) {
            Ok(output) => output,
            Err(e) => {
                error!(
                    "[Core] Could not parse STDOUT from dotnet --list-runtimes: {}",
                    e
                );
                return Err("FAILED_VERSION_LISTING".into());
            }
        },
        Err(_) => String::from(""),
    };
    let output = output.split("\r\n");
    let mut versions = Vec::<String>::new();
    for line in output {
        if line.starts_with(runtime) {
            let line = line.split(" ").collect::<Vec<&str>>();
            if line.len() < 2 {
                continue;
            }
            let version = line[1].to_string();
            if !is_semver(&version) {
                return Err("FAILED_VERSION_PARSING".into());
            }
            versions.push(version);
        }
    }
    Ok(versions)
}

fn is_semver(version: &String) -> bool {
    let version = version.split(".").collect::<Vec<&str>>();
    if version.len() != 3 {
        return false;
    }
    for i in 0..3 {
        if version[i].parse::<u32>().is_err() {
            return false;
        }
    }
    true
}

// true = a is higher
pub fn is_semver_higher(a: &String, b: &String) -> Result<bool, String> {
    if !is_semver(a) || !is_semver(b) {
        return Err("INVALID_VERSION".into());
    }
    let a = a.split(".").collect::<Vec<&str>>();
    let b = b.split(".").collect::<Vec<&str>>();
    let mut a = a
        .iter()
        .map(|x| x.parse::<u32>().unwrap())
        .collect::<Vec<u32>>();
    let mut b = b
        .iter()
        .map(|x| x.parse::<u32>().unwrap())
        .collect::<Vec<u32>>();
    while a.len() < b.len() {
        a.push(0);
    }
    while b.len() < a.len() {
        b.push(0);
    }
    for i in 0..a.len() {
        if a[i] > b[i] {
            return Ok(true);
        }
        if a[i] < b[i] {
            return Ok(false);
        }
    }
    Ok(false)
}

pub async fn install_net_core(version: &String) -> Result<(), String> {
    if !is_semver(version) {
        error!(
            "[Core] Tried installing invalid .NET Core runtime version: {}",
            version
        );
        return Err("INVALID_VERSION".into());
    }
    let installer_url = format!(
        "https://dotnetcli.azureedge.net/dotnet/Runtime/{}/dotnet-runtime-{}-win-x64.exe",
        version, version
    );
    info!(
        "[Core] Downloading .NET Core {} installer from ({})",
        version, installer_url
    );
    download_and_install(installer_url).await
}

pub async fn install_asp_net_core(version: &String) -> Result<(), String> {
    if !is_semver(version) {
        error!(
            "[Core] Tried installing ASP.NET Core runtime version: {}",
            version
        );
        return Err("INVALID_VERSION".into());
    }
    let installer_url = format!(
        "https://dotnetcli.azureedge.net/dotnet/aspnetcore/Runtime/{}/aspnetcore-runtime-{}-win-x64.exe",
        version, version
    );
    info!(
        "[Core] Downloading ASP.NET Core {} installer from ({})",
        version, installer_url
    );
    download_and_install(installer_url).await
}

pub async fn install_dotnet_hosting_bundle(version: &String) -> Result<(), String> {
    if !is_semver(version) {
        error!(
            "[Core] Tried installing ASP.NET Core runtime version: {}",
            version
        );
        return Err("INVALID_VERSION".into());
    }
    let installer_url = format!(
        "https://dotnetcli.azureedge.net/dotnet/aspnetcore/Runtime/{}/dotnet-hosting-{}-win.exe",
        version, version
    );
    info!(
        "[Core] Downloading ASP.NET Core {} installer from ({})",
        version, installer_url
    );
    download_and_install(installer_url).await
}

async fn download_and_install(url: String) -> Result<(), String> {
    let tmp_dir = match Builder::new()
        .prefix("oyasumivr_dotnet_installer_")
        .tempdir()
    {
        Ok(d) => d,
        Err(e) => {
            error!("[Core] Failed to create temporary directory: {}", e);
            return Err("FAILED_TO_CREATE_TEMPORARY_DIRECTORY".into());
        }
    };
    let response = match reqwest::get(url).await {
        Ok(r) => r,
        Err(e) => {
            error!("[Core] Failed to download installer: {}", e);
            return Err("FAILED_TO_DOWNLOAD_INSTALLER".into());
        }
    };
    let fname = response
        .url()
        .path_segments()
        .and_then(|segments| segments.last())
        .and_then(|name| if name.is_empty() { None } else { Some(name) })
        .unwrap_or("tmp.exe");
    let fname = tmp_dir.path().join(fname);
    let mut dest = {
        match File::create(fname.clone()) {
            Ok(f) => f,
            Err(e) => {
                error!("[Core] Failed to create temporary installer file: {}", e);
                return Err("FAILED_TO_CREATE_INSTALLER_FILE".into());
            }
        }
    };
    // Write file from response to file
    let content = match response.bytes().await {
        Ok(c) => c,
        Err(e) => {
            error!("[Core] Failed to download installer: {}", e);
            return Err("FAILED_TO_DOWNLOAD_INSTALLER".into());
        }
    };
    match std::io::copy(&mut content.as_ref(), &mut dest) {
        Ok(_) => {}
        Err(e) => {
            error!("[Core] Failed to write installer to disk: {}", e);
            return Err("FAILED_TO_WRITE_INSTALLER_TO_DISK".into());
        }
    };
    info!(
        "[Core] Installer downloaded to {}. Running installer...",
        fname.as_os_str().to_str().unwrap_or("unknown path")
    );
    drop(dest);
    // run installer with /install /quiet /norestart and get the exit code
    let output = match Command::new(fname.to_str().unwrap())
        .arg("/install")
        .arg("/quiet")
        .arg("/norestart")
        .output()
    {
        Ok(i) => i,
        Err(e) => {
            error!("[Core] Failed to run installer: {}", e);
            return Err("FAILED_TO_RUN_INSTALLER".into());
        }
    };
    if !output.status.success() {
        error!(
            "[Core] Installer exited with non-zero exit code: {}",
            output.status.code().unwrap()
        );
        return Err("INSTALLER_EXITED_WITH_NONZERO_EXIT_CODE".into());
    }
    info!("[Core] Runtime installation complete!");
    Ok(())
}
