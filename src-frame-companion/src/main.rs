use oyasumivr_frame_companion::{
    config::{CompanionConfig, ReleaseMetadata},
    server::{self, ServerState},
};
use raphii_openvr_rs as openvr;
use std::{
    env, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

const BUILD_VERSION: &str = match option_env!("OYASUMIVR_FRAME_BUILD_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

fn usage() -> ! {
    eprintln!("usage: oyasumivr-frame-companion serve --config PATH");
    std::process::exit(2)
}

fn arguments() -> PathBuf {
    let mut args = env::args_os().skip(1);
    if args.next().as_deref() != Some("serve".as_ref())
        || args.next().as_deref() != Some("--config".as_ref())
    {
        usage();
    }
    let path = args.next().map(PathBuf::from).unwrap_or_else(|| usage());
    if args.next().is_some() {
        usage();
    }
    path
}

fn release_metadata(config_path: &Path) -> io::Result<ReleaseMetadata> {
    let executable = env::current_exe()?;
    let beside_binary = executable
        .parent()
        .ok_or_else(|| io::Error::other("companion executable has no parent"))?
        .join("release.json");
    ReleaseMetadata::read(&beside_binary).or_else(|_| {
        let current = config_path
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| io::Error::other("configuration has no installation root"))?
            .join("current/release.json");
        ReleaseMetadata::read(&current)
    })
}

fn monitor_openvr(
    ready: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    library_path: Option<PathBuf>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        while !stopping.load(Ordering::Acquire) {
            let context = match &library_path {
                Some(path) => unsafe {
                    openvr::Context::init_from_path(
                        path,
                        openvr::raw::EVRApplicationType::VRApplication_Background,
                    )
                },
                None => {
                    openvr::Context::init(openvr::raw::EVRApplicationType::VRApplication_Background)
                }
            };
            match context {
                Ok(context) => {
                    ready.store(true, Ordering::Release);
                    while !stopping.load(Ordering::Acquire) {
                        match context.system().poll_next_event() {
                            Ok(Some(event))
                                if event.is(openvr::raw::EVREventType::VREvent_Quit) =>
                            {
                                break;
                            }
                            Ok(_) => thread::sleep(Duration::from_millis(100)),
                            Err(_) => break,
                        }
                    }
                    ready.store(false, Ordering::Release);
                    context.shutdown();
                }
                Err(_) => thread::sleep(Duration::from_secs(3)),
            }
        }
        ready.store(false, Ordering::Release);
    })
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if env::args().nth(1).as_deref() == Some("probe-identity") {
        let path = env::args()
            .nth(2)
            .ok_or("identity probe requires an OpenVR library path")?;
        if env::args().count() != 3 || !Path::new(&path).is_absolute() {
            return Err("invalid identity probe arguments".into());
        }
        let identity = unsafe {
            openvr::Context::init_from_path(Path::new(&path), openvr::raw::EVRApplicationType::VRApplication_Background)
        }.ok().and_then(|context| {
            let system = context.system();
            let hmd = openvr::TrackedDeviceIndex(0);
            if system.get_tracked_device_class(hmd).ok() != Some(openvr::raw::ETrackedDeviceClass::TrackedDeviceClass_HMD) {
                context.shutdown();
                return None;
            }
            let serial: Option<String> = system.get_tracked_device_property(hmd, openvr::raw::ETrackedDeviceProperty::Prop_SerialNumber_String).ok();
            let model: Option<String> = system.get_tracked_device_property(hmd, openvr::raw::ETrackedDeviceProperty::Prop_ModelNumber_String).ok();
            let manufacturer: Option<String> = system.get_tracked_device_property(hmd, openvr::raw::ETrackedDeviceProperty::Prop_ManufacturerName_String).ok();
            context.shutdown();
            Some(serde_json::json!({"serial": serial?, "model": model?, "manufacturer": manufacturer?}))
        });
        println!(
            "{}",
            serde_json::json!({"identity": identity, "build_version": BUILD_VERSION})
        );
        return Ok(());
    }
    let config_path = arguments();
    let config = CompanionConfig::read(&config_path)?;
    let release = release_metadata(&config_path)?;
    if release.protocol_major != oyasumivr_frame_protocol::PROTOCOL.major
        || release.protocol_minor != oyasumivr_frame_protocol::PROTOCOL.minor
        || release.build_version != BUILD_VERSION
    {
        return Err("release metadata does not match companion".into());
    }
    let openvr_library_path = config.openvr_library_path.as_deref().map(PathBuf::from);
    let state = ServerState::new(config, BUILD_VERSION.into());
    let stopping = Arc::new(AtomicBool::new(false));
    let monitor = monitor_openvr(
        state.steamvr_ready.clone(),
        stopping.clone(),
        openvr_library_path,
    );
    let running = server::start(state).await?;
    shutdown_signal().await;
    stopping.store(true, Ordering::Release);
    running.stop().await;
    let _ = monitor.join();
    Ok(())
}
