use adlx::{
    ffi,
    gpu::Gpu,
    interface::{Interface, InterfaceImpl},
    result::Error as AdlxError,
    system::System,
};
use std::{ffi::c_void, mem::MaybeUninit, ops::Deref};

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub(super) struct IADLXGPUTuningServicesVtbl {
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
pub(super) struct IADLXManualPowerTuning {
    p_vtbl: *const IADLXManualPowerTuningVtbl,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub(super) struct IADLXManualPowerTuningVtbl {
    acquire: Option<unsafe extern "C" fn(p_this: *mut IADLXManualPowerTuning) -> ffi::adlx_long>,
    release: Option<unsafe extern "C" fn(p_this: *mut IADLXManualPowerTuning) -> ffi::adlx_long>,
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
    acquire: Option<unsafe extern "C" fn(p_this: *mut IADLXManualPowerTuning1) -> ffi::adlx_long>,
    release: Option<unsafe extern "C" fn(p_this: *mut IADLXManualPowerTuning1) -> ffi::adlx_long>,
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
pub(super) struct GpuTuningServices(InterfaceImpl);

unsafe impl Interface for GpuTuningServices {
    type Impl = ffi::IADLXGPUTuningServices;
    type Vtable = IADLXGPUTuningServicesVtbl;
    const IID: &'static str = "IADLXGPUTuningServices";
}

#[derive(Clone, Debug)]
#[repr(transparent)]
pub(super) struct ManualPowerTuning(InterfaceImpl);

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
    pub(super) fn from_system(system: &System) -> adlx::result::Result<Self> {
        let mut tuning_services = MaybeUninit::uninit();
        let system_raw = unsafe { system_as_raw(system) };
        let result = unsafe {
            ((*(*system_raw).pVtbl).GetGPUTuningServices.unwrap())(
                system_raw,
                tuning_services.as_mut_ptr(),
            )
        };

        AdlxError::from_result_with_assume_init_on_success(result, tuning_services)
            .map(|services| unsafe { Self::from_raw(services) })
    }

    pub(super) fn is_supported_manual_power_tuning(&self, gpu: &Gpu) -> adlx::result::Result<bool> {
        let mut supported = MaybeUninit::uninit();
        let result = unsafe {
            (self.vtable().is_supported_manual_power_tuning.unwrap())(
                self.as_raw(),
                gpu.as_raw(),
                supported.as_mut_ptr(),
            )
        };

        AdlxError::from_result_with_assume_init_on_success(result, supported)
            .map(|value| value != 0)
    }

    pub(super) fn manual_power_tuning(&self, gpu: &Gpu) -> adlx::result::Result<ManualPowerTuning> {
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

        // ADLX returns the requested interface behind an IADLXInterface pointer.
        Ok(unsafe { ManualPowerTuning::from_raw(manual_power_tuning.cast()) })
    }
}

impl ManualPowerTuning {
    pub(super) fn power_limit_range(&self) -> adlx::result::Result<ffi::ADLX_IntRange> {
        let mut tuning_range = MaybeUninit::uninit();
        let result = unsafe {
            (self.vtable().get_power_limit_range.unwrap())(self.as_raw(), tuning_range.as_mut_ptr())
        };

        AdlxError::from_result_with_assume_init_on_success(result, tuning_range)
    }

    pub(super) fn power_limit(&self) -> adlx::result::Result<i32> {
        let mut current_value = MaybeUninit::uninit();
        let result = unsafe {
            (self.vtable().get_power_limit.unwrap())(self.as_raw(), current_value.as_mut_ptr())
        };

        AdlxError::from_result_with_assume_init_on_success(result, current_value)
    }

    pub(super) fn set_power_limit(&self, value: i32) -> adlx::result::Result<()> {
        let result = unsafe { (self.vtable().set_power_limit.unwrap())(self.as_raw(), value) };
        AdlxError::from_result(result)
    }

    pub(super) fn power_limit_default(&self) -> adlx::result::Result<i32> {
        self.cast::<ManualPowerTuning1>()?.power_limit_default()
    }
}

impl ManualPowerTuning1 {
    fn power_limit_default(&self) -> adlx::result::Result<i32> {
        let mut default_value = MaybeUninit::uninit();
        let result = unsafe {
            (self.vtable().get_power_limit_default.unwrap())(
                self.as_raw(),
                default_value.as_mut_ptr(),
            )
        };

        AdlxError::from_result_with_assume_init_on_success(result, default_value)
    }
}

unsafe fn system_as_raw(system: &System) -> *mut ffi::IADLXSystem {
    *(system as *const _ as *const *mut ffi::IADLXSystem)
}
