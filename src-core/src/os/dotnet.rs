use std::{fs::File, process::Command};

use log::{error, info};
use tempfile::Builder;

// RETURN VALUES:
// INSTALL_NETCORE, UPGRADE_NETCORE, DOWNGRADE_NETCORE, INSTALL_ASPNETCORE, UPGRADE_ASPNETCORE, DOWNGRADE_ASPNETCORE
// ERRORS:
// FAILED_VERSION_CHECK, FAILED_VERSION_LISTING, FAILED_VERSION_PARSING, INVALID_VERSION
pub fn check_dotnet_upgrades_required() -> Result<Vec<String>, String> {
    let netcore_version = match get_net_core_version() {
        Ok(version) => version,
        Err(e) => {
            error!("Failed to get .NET Core version: {}", e);
            return Err("FAILED_VERSION_CHECK".into());
        }
    };
    let aspnetcore_version = match get_asp_net_core_version() {
        Ok(version) => version,
        Err(e) => {
            error!("Failed to get ASP.NET Core version: {}", e);
            return Err("FAILED_VERSION_CHECK".into());
        }
    };
    let mut upgrades_required = Vec::<String>::new();
    // Check if .NET Core is missing entirely (Requires install)
    if let None = netcore_version.clone() {
        upgrades_required.push("INSTALL_NETCORE".into());
    } else if let Some(v) = netcore_version.clone() {
        // Check if installed version is below 7.0.0 (Requires upgrade)
        match is_semver_higher(&String::from("7.0.0"), &v) {
            Ok(below7) => {
                if below7 {
                    upgrades_required.push("UPGRADE_NETCORE".into());
                }
            }
            Err(e) => {
                error!("Failed to compare versions: {} {} {}", "7.0.0", v, e);
                return Err("FAILED_VERSION_CHECK".into());
            }
        };
        // Check if installed version is above 7.1 (Requires downgrade)
        match is_semver_higher(&v, &String::from("7.1.0")) {
            Ok(above71) => {
                if above71 {
                    upgrades_required.push("DOWNGRADE_NETCORE".into());
                }
            }
            Err(e) => {
                error!("Failed to compare versions: {} {} {}", v, "7.1.0", e);
                return Err("FAILED_VERSION_CHECK".into());
            }
        };
    }
    if let None = aspnetcore_version.clone() {
        upgrades_required.push("INSTALL_ASPNETCORE".into());
    } else if let Some(v) = aspnetcore_version.clone() {
        // Check if installed version is below 7.0.0 (Requires upgrade)
        match is_semver_higher(&String::from("7.0.0"), &v) {
            Ok(below7) => {
                if below7 {
                    upgrades_required.push("UPGRADE_ASPNETCORE".into());
                }
            }
            Err(e) => {
                error!("Failed to compare versions: {} {} {}", "7.0.0", v, e);
                return Err("FAILED_VERSION_CHECK".into());
            }
        };
        // Check if installed version is above 7.1 (Requires downgrade)
        match is_semver_higher(&v, &String::from("7.1.0")) {
            Ok(above71) => {
                if above71 {
                    upgrades_required.push("DOWNGRADE_ASPNETCORE".into());
                }
            }
            Err(e) => {
                error!("Failed to compare versions: {} {} {}", v, "7.1.0", e);
                return Err("FAILED_VERSION_CHECK".into());
            }
        };
    }
    // Check if patch versions match
    if let Some(netcorever) = netcore_version.clone() {
        if let Some(aspnetcorever) = aspnetcore_version.clone() {
            let netcorever = netcorever.split(".").collect::<Vec<&str>>();
            let aspnetcorever = aspnetcorever.split(".").collect::<Vec<&str>>();
            if netcorever[2] < aspnetcorever[2] {
                upgrades_required.push("UPGRADE_NETCORE".into());
            } else if netcorever[2] > aspnetcorever[2] {
                upgrades_required.push("UPGRADE_ASPNETCORE".into());
            }
        }
    }
    return Ok(upgrades_required);
}

pub fn get_net_core_version() -> Result<Option<String>, String> {
    get_dotnet_version("Microsoft.NETCore.App")
}

pub fn get_asp_net_core_version() -> Result<Option<String>, String> {
    get_dotnet_version("Microsoft.AspNetCore.App")
}

fn get_dotnet_version(runtime: &str) -> Result<Option<String>, String> {
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
    let mut highest_version: Option<String> = None;
    for line in output {
        if line.starts_with(runtime) {
            let line = line.split(" ").collect::<Vec<&str>>();
            if line.len() < 2 {
                continue;
            }
            let version = line[1].to_string();
            // if highest_version is None
            if let None = highest_version {
                highest_version = Some(version);
                continue;
            }
            let hversion = highest_version.clone().unwrap();
            let higher = match is_semver_higher(&version, &hversion) {
                Ok(higher) => higher,
                Err(e) => {
                    error!(
                        "[Core] Failed to compare versions: {} {} {}",
                        version, &hversion, e
                    );
                    return Err("FAILED_VERSION_PARSING".into());
                }
            };
            if higher {
                highest_version = Some(version);
            }
        }
    }
    Ok(highest_version)
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

pub async fn upgrade_net_core(version: &String) -> Result<(), String> {
    if !is_semver(version) {
        error!(
            "[Core] Tried upgrading .NET Core runtime to invalid version: {}",
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

pub async fn upgrade_asp_net_core(version: &String) -> Result<(), String> {
    if !is_semver(version) {
        error!(
            "[Core] Tried upgrading ASP.NET Core runtime to invalid version: {}",
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
    info!("[Core] Installation complete!");
    Ok(())
}
