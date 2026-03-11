use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError};

use adlx::{
    ffi,
    gpu::Gpu,
    helper::AdlxHelper,
    interface::{Interface, InterfaceImpl},
    result::Error as AdlxError,
    system::System,
};
use log::{error, info, warn};
use std::{
    ffi::c_void,
    mem::MaybeUninit,
    ops::Deref,
    sync::{mpsc, OnceLock},
    thread,
};

const ADLX_UUID_PREFIX: &str = "adlx:";
const ADLX_VENDOR_ID_HEX: &str = "1002";
const ADLX_POWER_LIMIT_SHIFT_PERCENT: i32 = 100;
const ADLX_POWER_LIMIT_SCALE: u32 = 1000;

enum AdlxCommand {
    GetDevices(mpsc::Sender<Vec<NvmlDevice>>),
    SetPowerLimit {
        uuid: String,
        encoded_limit: u32,
        tx: mpsc::Sender<Result<bool, NvmlSetPowerManagementLimitError>>,
    },
}

struct AdlxWorker {
    tx: mpsc::Sender<AdlxCommand>,
}

static ADLX_WORKER: OnceLock<Result<AdlxWorker, String>> = OnceLock::new();

#[derive(Clone, Debug)]
struct AdlxCachedDevice {
    device: NvmlDevice,
    manual_tuning: ManualPowerTuning,
}

fn get_or_init_worker() -> Result<&'static AdlxWorker, String> {
    match ADLX_WORKER.get_or_init(|| {
        let (command_tx, command_rx) = mpsc::channel::<AdlxCommand>();
        let (init_tx, init_rx) = mpsc::channel::<Result<(), String>>();

        thread::Builder::new()
            .name("oyasumi-adlx-worker".to_owned())
            .spawn(move || {
                let helper = match AdlxHelper::new() {
                    Ok(helper) => helper,
                    Err(err) => {
                        let _ = init_tx.send(Err(err.to_string()));
                        return;
                    }
                };
                let tuning_services = match get_gpu_tuning_services(helper.system()) {
                    Ok(services) => services,
                    Err(err) => {
                        let _ = init_tx.send(Err(err.to_string()));
                        return;
                    }
                };
                let mut cached_devices = enumerate_cached_devices_impl(&helper, &tuning_services);
                let _ = init_tx.send(Ok(()));

                while let Ok(command) = command_rx.recv() {
                    match command {
                        AdlxCommand::GetDevices(tx) => {
                            let _ = tx.send(
                                cached_devices
                                    .iter()
                                    .map(|device| device.device.clone())
                                    .collect(),
                            );
                        }
                        AdlxCommand::SetPowerLimit {
                            uuid,
                            encoded_limit,
                            tx,
                        } => {
                            let result = set_power_management_limit_impl(
                                &mut cached_devices,
                                uuid,
                                encoded_limit,
                            );
                            let _ = tx.send(result);
                        }
                    }
                }
            })
            .map_err(|err| err.to_string())?;

        init_rx
            .recv()
            .map_err(|err| err.to_string())?
            .map(|()| AdlxWorker { tx: command_tx })
    }) {
        Ok(worker) => Ok(worker),
        Err(err) => Err(err.clone()),
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
struct IADLXGPUTuningServicesVtbl {
    acquire:
        Option<unsafe extern "C" fn(p_this: *mut ffi::IADLXGPUTuningServices) -> ffi::adlx_long>,
    release:
        Option<unsafe extern "C" fn(p_this: *mut ffi::IADLXGPUTuningServices) -> ffi::adlx_long>,
    query_interface: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            interface_id: *const ffi::wchar_t,
            pp_interface: *mut *mut c_void,
        ) -> ffi::ADLX_RESULT,
    >,
    get_gpu_tuning_changed_handling: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            pp_gpu_tuning_changed_handling: *mut *mut c_void,
        ) -> ffi::ADLX_RESULT,
    >,
    is_at_factory: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            is_factory: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    reset_to_factory: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
        ) -> ffi::ADLX_RESULT,
    >,
    is_supported_auto_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            supported: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    is_supported_preset_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            supported: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    is_supported_manual_gfx_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            supported: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    is_supported_manual_vram_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            supported: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    is_supported_manual_fan_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            supported: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    is_supported_manual_power_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            supported: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    get_auto_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            pp_auto_tuning: *mut *mut ffi::IADLXInterface,
        ) -> ffi::ADLX_RESULT,
    >,
    get_preset_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            pp_preset_tuning: *mut *mut ffi::IADLXInterface,
        ) -> ffi::ADLX_RESULT,
    >,
    get_manual_gfx_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            pp_manual_gfx_tuning: *mut *mut ffi::IADLXInterface,
        ) -> ffi::ADLX_RESULT,
    >,
    get_manual_vram_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            pp_manual_vram_tuning: *mut *mut ffi::IADLXInterface,
        ) -> ffi::ADLX_RESULT,
    >,
    get_manual_fan_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            pp_manual_fan_tuning: *mut *mut ffi::IADLXInterface,
        ) -> ffi::ADLX_RESULT,
    >,
    get_manual_power_tuning: Option<
        unsafe extern "C" fn(
            p_this: *mut ffi::IADLXGPUTuningServices,
            p_gpu: *mut ffi::IADLXGPU,
            pp_manual_power_tuning: *mut *mut ffi::IADLXInterface,
        ) -> ffi::ADLX_RESULT,
    >,
}

#[repr(C)]
struct IADLXManualPowerTuning {
    p_vtbl: *const IADLXManualPowerTuningVtbl,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
struct IADLXManualPowerTuningVtbl {
    acquire:
        Option<unsafe extern "C" fn(p_this: *mut IADLXManualPowerTuning) -> ffi::adlx_long>,
    release:
        Option<unsafe extern "C" fn(p_this: *mut IADLXManualPowerTuning) -> ffi::adlx_long>,
    query_interface: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning,
            interface_id: *const ffi::wchar_t,
            pp_interface: *mut *mut c_void,
        ) -> ffi::ADLX_RESULT,
    >,
    get_power_limit_range: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning,
            tuning_range: *mut ffi::ADLX_IntRange,
        ) -> ffi::ADLX_RESULT,
    >,
    get_power_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning,
            cur_val: *mut ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
    set_power_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning,
            cur_val: ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
    is_supported_tdc_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning,
            supported: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    get_tdc_limit_range: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning,
            tuning_range: *mut ffi::ADLX_IntRange,
        ) -> ffi::ADLX_RESULT,
    >,
    get_tdc_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning,
            cur_val: *mut ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
    set_tdc_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning,
            cur_val: ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
}

#[repr(C)]
struct IADLXManualPowerTuning1 {
    p_vtbl: *const IADLXManualPowerTuning1Vtbl,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
struct IADLXManualPowerTuning1Vtbl {
    acquire:
        Option<unsafe extern "C" fn(p_this: *mut IADLXManualPowerTuning1) -> ffi::adlx_long>,
    release:
        Option<unsafe extern "C" fn(p_this: *mut IADLXManualPowerTuning1) -> ffi::adlx_long>,
    query_interface: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            interface_id: *const ffi::wchar_t,
            pp_interface: *mut *mut c_void,
        ) -> ffi::ADLX_RESULT,
    >,
    get_power_limit_range: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            tuning_range: *mut ffi::ADLX_IntRange,
        ) -> ffi::ADLX_RESULT,
    >,
    get_power_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            cur_val: *mut ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
    set_power_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            cur_val: ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
    is_supported_tdc_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            supported: *mut ffi::adlx_bool,
        ) -> ffi::ADLX_RESULT,
    >,
    get_tdc_limit_range: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            tuning_range: *mut ffi::ADLX_IntRange,
        ) -> ffi::ADLX_RESULT,
    >,
    get_tdc_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            cur_val: *mut ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
    set_tdc_limit: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            cur_val: ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
    get_power_limit_default: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            default_val: *mut ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
    get_tdc_limit_default: Option<
        unsafe extern "C" fn(
            p_this: *mut IADLXManualPowerTuning1,
            default_val: *mut ffi::adlx_int,
        ) -> ffi::ADLX_RESULT,
    >,
}

#[derive(Clone, Debug)]
#[repr(transparent)]
struct GpuTuningServices(InterfaceImpl);

unsafe impl Interface for GpuTuningServices {
    type Impl = ffi::IADLXGPUTuningServices;
    type Vtable = IADLXGPUTuningServicesVtbl;
    const IID: &'static str = "IADLXGPUTuningServices";
}

#[derive(Clone, Debug)]
#[repr(transparent)]
struct ManualPowerTuning(InterfaceImpl);

unsafe impl Interface for ManualPowerTuning {
    type Impl = IADLXManualPowerTuning;
    type Vtable = IADLXManualPowerTuningVtbl;
    const IID: &'static str = "IADLXManualPowerTuning";
}

#[derive(Clone, Debug)]
#[repr(transparent)]
struct ManualPowerTuning1(ManualPowerTuning);

unsafe impl Interface for ManualPowerTuning1 {
    type Impl = IADLXManualPowerTuning1;
    type Vtable = IADLXManualPowerTuning1Vtbl;
    const IID: &'static str = "IADLXManualPowerTuning1";
}

impl Deref for ManualPowerTuning1 {
    type Target = ManualPowerTuning;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl GpuTuningServices {
    fn is_supported_manual_power_tuning(&self, gpu: &Gpu) -> adlx::result::Result<bool> {
        let mut supported = MaybeUninit::uninit();
        let result = unsafe {
            (self.vtable().is_supported_manual_power_tuning.unwrap())(
                self.as_raw(),
                gpu.as_raw(),
                supported.as_mut_ptr(),
            )
        };

        AdlxError::from_result_with_assume_init_on_success(result, supported).map(|value| value != 0)
    }

    fn manual_power_tuning(&self, gpu: &Gpu) -> adlx::result::Result<ManualPowerTuning> {
        let mut manual_power_tuning = MaybeUninit::<*mut ffi::IADLXInterface>::uninit();
        let result = unsafe {
            (self.vtable().get_manual_power_tuning.unwrap())(
                self.as_raw(),
                gpu.as_raw(),
                manual_power_tuning.as_mut_ptr(),
            )
        };
        let manual_power_tuning =
            AdlxError::from_result_with_assume_init_on_success(result, manual_power_tuning)?;

        // ADLX returns the requested interface behind an IADLXInterface pointer here.
        // QueryInterface-ing it again regressed AMD power writes with "unknown interface asked".
        Ok(unsafe { ManualPowerTuning::from_raw(manual_power_tuning.cast()) })
    }
}

impl ManualPowerTuning {
    fn power_limit_range(&self) -> adlx::result::Result<ffi::ADLX_IntRange> {
        let mut tuning_range = MaybeUninit::uninit();
        let result = unsafe {
            (self.vtable().get_power_limit_range.unwrap())(self.as_raw(), tuning_range.as_mut_ptr())
        };

        AdlxError::from_result_with_assume_init_on_success(result, tuning_range)
    }

    fn power_limit(&self) -> adlx::result::Result<i32> {
        let mut current_value = MaybeUninit::uninit();
        let result = unsafe {
            (self.vtable().get_power_limit.unwrap())(self.as_raw(), current_value.as_mut_ptr())
        };

        AdlxError::from_result_with_assume_init_on_success(result, current_value)
    }

    fn set_power_limit(&self, value: i32) -> adlx::result::Result<()> {
        let result = unsafe { (self.vtable().set_power_limit.unwrap())(self.as_raw(), value) };
        AdlxError::from_result(result)
    }
}

impl ManualPowerTuning1 {
    fn power_limit_default(&self) -> adlx::result::Result<i32> {
        let mut default_value = MaybeUninit::uninit();
        let result = unsafe {
            (self.vtable().get_power_limit_default.unwrap())(self.as_raw(), default_value.as_mut_ptr())
        };

        AdlxError::from_result_with_assume_init_on_success(result, default_value)
    }
}

pub fn init() -> bool {
    info!("[ADLX] Probing ADLX backend");

    let worker = match get_or_init_worker() {
        Ok(worker) => worker,
        Err(err) => {
            warn!("[ADLX] ADLX backend unavailable: {err}");
            return false;
        }
    };

    let (tx, rx) = mpsc::channel();
    if worker.tx.send(AdlxCommand::GetDevices(tx)).is_err() {
        warn!("[ADLX] ADLX backend unavailable: worker channel closed");
        return false;
    }

    match rx.recv() {
        Ok(_) => {
            info!("[ADLX] ADLX backend is available");
            true
        }
        Err(err) => {
            warn!("[ADLX] ADLX backend unavailable: {err}");
            false
        }
    }
}


pub fn is_adlx_uuid(uuid: &str) -> bool {
    uuid.starts_with(ADLX_UUID_PREFIX)
}

pub fn get_devices() -> Vec<NvmlDevice> {
    let worker = match get_or_init_worker() {
        Ok(worker) => worker,
        Err(err) => {
            error!("[ADLX] Could not initialize ADLX: {err}");
            return Vec::new();
        }
    };

    let (tx, rx) = mpsc::channel();
    if worker.tx.send(AdlxCommand::GetDevices(tx)).is_err() {
        error!("[ADLX] Could not query ADLX devices: worker channel closed");
        return Vec::new();
    }

    match rx.recv() {
        Ok(devices) => devices,
        Err(err) => {
            error!("[ADLX] Could not query ADLX devices: {err}");
            Vec::new()
        }
    }
}

fn enumerate_cached_devices_impl(
    helper: &AdlxHelper,
    tuning_services: &GpuTuningServices,
) -> Vec<AdlxCachedDevice> {
    info!("[ADLX] Enumerating ADLX power-limit devices");
    let gpus = match helper.system().gpus() {
        Ok(gpus) => gpus,
        Err(err) => {
            error!("[ADLX] Could not enumerate ADLX devices: {err:?}");
            return Vec::new();
        }
    };

    let mut devices = Vec::new();

    for (index, gpu) in gpus.iter().enumerate() {
        info!("[ADLX] Inspecting GPU {}", index);
        if !is_amd_gpu(&gpu) {
            info!("[ADLX] Skipping non-AMD GPU {}", index);
            continue;
        }

        let supports_manual_power = tuning_services
            .is_supported_manual_power_tuning(&gpu)
            .unwrap_or(false);
        if !supports_manual_power {
            info!("[ADLX] GPU {} does not support manual power tuning", index);
            continue;
        }

        info!("[ADLX] GPU {} supports manual power tuning", index);
        let manual_tuning = match tuning_services.manual_power_tuning(&gpu) {
            Ok(manual_tuning) => manual_tuning,
            Err(err) => {
                warn!(
                    "[ADLX] Could not access manual power tuning interface for GPU {}: {:?}",
                    index, err
                );
                continue;
            }
        };

        info!("[ADLX] Querying power limit range for GPU {}", index);
        let range = match manual_tuning.power_limit_range() {
            Ok(range) => range,
            Err(err) => {
                warn!(
                    "[ADLX] Could not query power limit range for GPU {}: {:?}",
                    index, err
                );
                continue;
            }
        };

        info!("[ADLX] Querying current power limit for GPU {}", index);
        let power_limit_percent = match manual_tuning.power_limit() {
            Ok(value) => value,
            Err(err) => {
                warn!(
                    "[ADLX] Could not query current power limit for GPU {}: {:?}",
                    index, err
                );
                continue;
            }
        };

        let default_power_limit_percent = manual_tuning
            .cast::<ManualPowerTuning1>()
            .and_then(|manual_tuning_1| manual_tuning_1.power_limit_default())
            .unwrap_or(power_limit_percent);

        info!("[ADLX] Querying unique id and name for GPU {}", index);
        let unique_id = gpu.unique_id().unwrap_or(index as i32);
        let name = gpu
            .name()
            .map(str::to_owned)
            .unwrap_or_else(|_| format!("AMD GPU {index}"));

        devices.push(AdlxCachedDevice {
            device: NvmlDevice {
                uuid: format!("{ADLX_UUID_PREFIX}{unique_id}"),
                name: format!("{name} (ADLX)"),
                power_limit: encode_power_limit_percent(power_limit_percent),
                min_power_limit: encode_power_limit_percent(range.minValue),
                max_power_limit: encode_power_limit_percent(range.maxValue),
                default_power_limit: encode_power_limit_percent(default_power_limit_percent),
            },
            manual_tuning,
        });
        info!("[ADLX] Added GPU {} to power-limit device list", index);
    }

    info!("[ADLX] Finished ADLX enumeration with {} devices", devices.len());
    devices
}


pub fn set_power_management_limit(
    uuid: String,
    encoded_limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    let worker = get_or_init_worker().map_err(|err| {
        error!("[ADLX] Could not initialize ADLX while setting power limit: {err}");
        NvmlSetPowerManagementLimitError::DeviceAccessError
    })?;

    let (tx, rx) = mpsc::channel();
    worker
        .tx
        .send(AdlxCommand::SetPowerLimit {
            uuid,
            encoded_limit,
            tx,
        })
        .map_err(|_| {
            error!("[ADLX] Could not set power limit: worker channel closed");
            NvmlSetPowerManagementLimitError::DeviceAccessError
        })?;

    rx.recv().map_err(|err| {
        error!("[ADLX] Could not receive power limit result: {err}");
        NvmlSetPowerManagementLimitError::DeviceAccessError
    })?
}

fn set_power_management_limit_impl(
    cached_devices: &mut [AdlxCachedDevice],
    uuid: String,
    encoded_limit: u32,
) -> Result<bool, NvmlSetPowerManagementLimitError> {
    info!(
        "[ADLX] Begin setting power limit for GPU (uuid:{}, encoded_limit={})",
        uuid, encoded_limit
    );
    let cached_device = cached_devices
        .iter_mut()
        .find(|device| device.device.uuid == uuid)
        .ok_or(NvmlSetPowerManagementLimitError::DeviceAccessError)?;

    let requested_percent = decode_power_limit_percent(encoded_limit);
    let min_percent = decode_power_limit_percent(cached_device.device.min_power_limit);
    let max_percent = decode_power_limit_percent(cached_device.device.max_power_limit);
    let clamped_percent = requested_percent.clamp(min_percent, max_percent);

    info!(
        "[ADLX] Using cached manual power tuning interface for GPU (uuid:{})",
        uuid
    );
    info!(
        "[ADLX] Applying power limit for GPU (uuid:{}) request={}%, clamped={}%",
        uuid, requested_percent, clamped_percent
    );
    cached_device
        .manual_tuning
        .set_power_limit(clamped_percent)
        .map_err(|err| {
            error!(
                "[ADLX] Could not set power limit for GPU (uuid:{}) due to: {:?}",
                uuid, err
            );
            NvmlSetPowerManagementLimitError::DeviceSetPowerLimitError
        })?;

    cached_device.device.power_limit = encode_power_limit_percent(clamped_percent);
    info!(
        "[ADLX] Set power limit for GPU (uuid:{}) request={}%, applied={}% using cached interface",
        uuid, requested_percent, clamped_percent
    );
    Ok(true)
}


fn get_gpu_tuning_services(system: &System) -> adlx::result::Result<GpuTuningServices> {
    let mut tuning_services = MaybeUninit::uninit();
    let system_raw = unsafe { system_as_raw(system) };
    let result = unsafe {
        ((*(*system_raw).pVtbl).GetGPUTuningServices.unwrap())(system_raw, tuning_services.as_mut_ptr())
    };

    AdlxError::from_result_with_assume_init_on_success(result, tuning_services)
        .map(|services| unsafe { GpuTuningServices::from_raw(services) })
}

unsafe fn system_as_raw(system: &System) -> *mut ffi::IADLXSystem {
    *(system as *const _ as *const *mut ffi::IADLXSystem)
}

fn is_amd_gpu(gpu: &Gpu) -> bool {
    gpu.vendor_id()
        .map(|vendor_id| normalize_vendor_id(vendor_id) == ADLX_VENDOR_ID_HEX)
        .unwrap_or(false)
}

fn normalize_vendor_id(vendor_id: &str) -> String {
    vendor_id
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_ascii_lowercase()
}

fn encode_power_limit_percent(percent: i32) -> u32 {
    let shifted = percent.saturating_add(ADLX_POWER_LIMIT_SHIFT_PERCENT);
    if shifted <= 0 {
        return 0;
    }
    (shifted as u32).saturating_mul(ADLX_POWER_LIMIT_SCALE)
}

fn decode_power_limit_percent(encoded: u32) -> i32 {
    let shifted_u32 = encoded / ADLX_POWER_LIMIT_SCALE;
    let shifted = if shifted_u32 > i32::MAX as u32 {
        i32::MAX
    } else {
        shifted_u32 as i32
    };
    shifted.saturating_sub(ADLX_POWER_LIMIT_SHIFT_PERCENT)
}

