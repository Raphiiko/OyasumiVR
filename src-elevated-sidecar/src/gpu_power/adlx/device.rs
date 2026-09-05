use super::{
    device_id,
    interface::{GpuTuningServices, ManualPowerTuning},
    value::{decode_percent, encode_percent},
};
use crate::Models::{NvmlDevice, NvmlSetPowerManagementLimitError};

use adlx::{gpu::Gpu, helper::AdlxHelper};
use log::{error, info, warn};

const AMD_VENDOR_ID_HEX: &str = "1002";

pub(super) struct Device {
    info: NvmlDevice,
    manual_tuning: ManualPowerTuning,
}

impl Device {
    pub(super) fn discover(helper: &AdlxHelper, tuning_services: &GpuTuningServices) -> Vec<Self> {
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
            if !is_amd_gpu(&gpu) {
                info!("[ADLX] Skipping non-AMD GPU {}", index);
                continue;
            }

            if !tuning_services
                .is_supported_manual_power_tuning(&gpu)
                .unwrap_or(false)
            {
                info!("[ADLX] GPU {} does not support manual power tuning", index);
                continue;
            }

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
                .power_limit_default()
                .unwrap_or(power_limit_percent);

            let unique_id = gpu.unique_id().unwrap_or(index as i32);
            let name = gpu
                .name()
                .map(str::to_owned)
                .unwrap_or_else(|_| format!("AMD GPU {index}"));

            devices.push(Self {
                info: NvmlDevice {
                    uuid: device_id(unique_id),
                    name: format!("{name} (ADLX)"),
                    power_limit: encode_percent(power_limit_percent),
                    min_power_limit: encode_percent(range.minValue),
                    max_power_limit: encode_percent(range.maxValue),
                    default_power_limit: encode_percent(default_power_limit_percent),
                },
                manual_tuning,
            });
        }

        info!(
            "[ADLX] Finished ADLX enumeration with {} devices",
            devices.len()
        );
        devices
    }

    pub(super) fn info(&self) -> &NvmlDevice {
        &self.info
    }

    pub(super) fn uuid(&self) -> &str {
        &self.info.uuid
    }

    pub(super) fn set_power_limit(
        &mut self,
        encoded_limit: u32,
    ) -> Result<bool, NvmlSetPowerManagementLimitError> {
        let requested_percent = decode_percent(encoded_limit);
        let min_percent = decode_percent(self.info.min_power_limit);
        let max_percent = decode_percent(self.info.max_power_limit);
        let clamped_percent = requested_percent.clamp(min_percent, max_percent);

        info!(
            "[ADLX] Applying power limit for GPU (device_id:{}) request={}%, clamped={}%",
            self.info.uuid, requested_percent, clamped_percent
        );
        self.manual_tuning
            .set_power_limit(clamped_percent)
            .map_err(|err| {
                error!(
                    "[ADLX] Could not set power limit for GPU (device_id:{}) due to: {:?}",
                    self.info.uuid, err
                );
                NvmlSetPowerManagementLimitError::DeviceSetPowerLimitError
            })?;

        self.info.power_limit = encode_percent(clamped_percent);
        info!(
            "[ADLX] Set power limit for GPU (device_id:{}) request={}%, applied={}%",
            self.info.uuid, requested_percent, clamped_percent
        );
        Ok(true)
    }
}

fn is_amd_gpu(gpu: &Gpu) -> bool {
    gpu.vendor_id()
        .map(|vendor_id| normalize_vendor_id(vendor_id) == AMD_VENDOR_ID_HEX)
        .unwrap_or(false)
}

fn normalize_vendor_id(vendor_id: &str) -> String {
    vendor_id
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::normalize_vendor_id;

    #[test]
    fn vendor_ids_are_normalized_for_adlx_comparison() {
        assert_eq!(normalize_vendor_id(" 0X1002 "), "1002");
        assert_eq!(normalize_vendor_id("0x1002"), "1002");
    }
}
