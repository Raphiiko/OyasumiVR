use crate::openvr::interface_table;
use ash::vk::{self, Handle};
use raphii_openvr_rs::raw;
use std::ffi::{c_char, CStr, CString};

/// Tells which Vulkan device and extensions SteamVR needs to read an overlay texture.
pub struct SteamVr {
    system: raw::VR_IVRSystem_FnTable,
    compositor: raw::VR_IVRCompositor_FnTable,
}

impl SteamVr {
    pub fn connect() -> Result<Self, String> {
        unsafe {
            Ok(Self {
                system: interface_table(raw::IVRSystem_Version)?,
                compositor: interface_table(raw::IVRCompositor_Version)?,
            })
        }
    }

    pub fn instance_extensions(&self) -> Result<Vec<CString>, String> {
        let get = required(self.compositor.GetVulkanInstanceExtensionsRequired)?;
        Ok(extensions(|buffer, size| unsafe { get(buffer, size) }))
    }

    pub fn device_extensions(&self, device: vk::PhysicalDevice) -> Result<Vec<CString>, String> {
        let get = required(self.compositor.GetVulkanDeviceExtensionsRequired)?;
        Ok(extensions(|buffer, size| unsafe {
            get(device.as_raw() as *mut _, buffer, size)
        }))
    }

    /// The physical device of `instance` that drives the headset.
    pub fn physical_device(&self, instance: vk::Instance) -> Result<vk::PhysicalDevice, String> {
        let mut device = 0;
        unsafe {
            required(self.system.GetOutputDevice)?(
                &mut device,
                raw::ETextureType::TextureType_Vulkan,
                instance.as_raw() as *mut _,
            );
        }
        if device == 0 {
            return Err("SteamVR did not identify a Vulkan device".into());
        }
        Ok(vk::PhysicalDevice::from_raw(device))
    }
}

/// Reads a space separated list; `get` returns the size it needs, including the nul.
fn extensions(get: impl Fn(*mut c_char, u32) -> u32) -> Vec<CString> {
    let size = get(std::ptr::null_mut(), 0);
    let mut buffer = vec![0u8; size as usize];
    if size > 0 {
        get(buffer.as_mut_ptr().cast(), size);
    }
    CStr::from_bytes_until_nul(&buffer)
        .unwrap_or_default()
        .to_string_lossy()
        .split_whitespace()
        .filter_map(|name| CString::new(name).ok())
        .collect()
}

fn required<T>(function: Option<T>) -> Result<T, String> {
    function.ok_or("Missing OpenVR Vulkan function".into())
}
