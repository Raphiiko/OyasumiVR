use std::time::Duration;
use log::info;
use crate::{afterburner, nvml, Models::NvmlStatus};

use super::oyasumi_elevated_sidecar::{
    oyasumi_elevated_sidecar_server::OyasumiElevatedSidecar, Empty, NvmlDevicesResponse,
    NvmlPowerManagementLimitRequest, NvmlPowerManagementLimitResponse, NvmlStatusResponse,
    SetMsiAfterburnerProfileRequest, SetMsiAfterburnerProfileResponse,
};
use tonic::{Request, Response, Status};
use crate::Models::PingResponse;

#[derive(Debug, Default)]
pub struct OyasumiElevatedSidecarServerImpl {}

#[tonic::async_trait]
impl OyasumiElevatedSidecar for OyasumiElevatedSidecarServerImpl {
    async fn ping(&self, _: Request<Empty>) -> Result<Response<PingResponse>, Status> {
        Ok(Response::new(PingResponse {
            pid: std::process::id(),
        }))
    }

    async fn request_stop(&self, _: Request<Empty>) -> Result<Response<Empty>, Status> {
        info!("Received request to stop");
        tokio::spawn(async {
            info!("Stopping...");
            tokio::time::sleep(Duration::from_millis(500)).await;
            std::process::exit(0);
        });
        Ok(Response::new(Empty {}))
    }

    async fn get_nvml_status(
        &self,
        _: Request<Empty>,
    ) -> Result<Response<NvmlStatusResponse>, Status> {
        let status: NvmlStatus = nvml::nvml_status().await;
        Ok(Response::new(NvmlStatusResponse {
            status: status.into(),
        }))
    }

    async fn get_nvml_devices(
        &self,
        _: Request<Empty>,
    ) -> Result<Response<NvmlDevicesResponse>, Status> {
        let devices = nvml::nvml_get_devices();
        Ok(Response::new(NvmlDevicesResponse { devices }))
    }

    async fn set_nvml_power_management_limit(
        &self,
        request: Request<NvmlPowerManagementLimitRequest>,
    ) -> Result<Response<NvmlPowerManagementLimitResponse>, Status> {
        let request = request.into_inner();
        let result = nvml::nvml_set_power_management_limit(request.uuid, request.power_limit).await;
        let success = result.is_ok();
        let error = match result {
            Ok(_) => None,
            Err(e) => Some(e),
        };
        Ok(Response::new(NvmlPowerManagementLimitResponse {
            success,
            error: error.map(|e| e.into()),
        }))
    }

    async fn set_msi_afterburner_profile(
        &self,
        request: Request<SetMsiAfterburnerProfileRequest>,
    ) -> Result<Response<SetMsiAfterburnerProfileResponse>, Status> {
        let request = request.into_inner();
        let result = afterburner::set_afterburner_profile(request.executable_path, request.profile);
        let success = result.is_ok();
        let error = match result {
            Ok(_) => None,
            Err(e) => Some(e),
        };
        Ok(Response::new(SetMsiAfterburnerProfileResponse {
            success,
            error: error.map(|e| e.into()),
        }))
    }
}
