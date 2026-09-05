use crate::Models::PingResponse;
use crate::{afterburner, gpu_power, Models::NvmlStatus};
use log::info;
use std::time::Duration;

use super::oyasumi_elevated_sidecar::{
    oyasumi_elevated_sidecar_server::OyasumiElevatedSidecar, Empty, NvmlDevicesResponse,
    NvmlPowerManagementLimitRequest, NvmlPowerManagementLimitResponse, NvmlStatusResponse,
    RemovePrivilegedLauncherResponse, SetErrorReportingEnabledRequest,
    SetMsiAfterburnerProfileRequest, SetMsiAfterburnerProfileResponse,
};
use tonic::{Request, Response, Status};

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

    async fn remove_privileged_launcher(
        &self,
        _: Request<Empty>,
    ) -> Result<Response<RemovePrivilegedLauncherResponse>, Status> {
        let disposition = tokio::task::spawn_blocking(crate::cleanup::remove_privileged_launcher)
            .await
            .map_err(|e| Status::internal(format!("cleanup task failed: {e}")))?
            .map_err(Status::internal)?;
        match disposition {
            crate::cleanup::CleanupDisposition::RemoveInstallation { .. } => {
                info!("Scheduled privileged launcher removal")
            }
            crate::cleanup::CleanupDisposition::RetainInstallation => {
                info!("Removed the scheduled task and retained the shared launcher")
            }
        }
        Ok(Response::new(RemovePrivilegedLauncherResponse {
            installation_retained: disposition
                == crate::cleanup::CleanupDisposition::RetainInstallation,
            cleanup_process_id: match disposition {
                crate::cleanup::CleanupDisposition::RemoveInstallation { process_id } => process_id,
                crate::cleanup::CleanupDisposition::RetainInstallation => 0,
            },
        }))
    }

    async fn set_error_reporting_enabled(
        &self,
        request: Request<SetErrorReportingEnabledRequest>,
    ) -> Result<Response<Empty>, Status> {
        crate::set_error_reporting_enabled(request.into_inner().enabled);
        Ok(Response::new(Empty {}))
    }

    async fn get_nvml_status(
        &self,
        _: Request<Empty>,
    ) -> Result<Response<NvmlStatusResponse>, Status> {
        let status: NvmlStatus = gpu_power::status();
        Ok(Response::new(NvmlStatusResponse {
            status: status.into(),
        }))
    }

    async fn get_nvml_devices(
        &self,
        _: Request<Empty>,
    ) -> Result<Response<NvmlDevicesResponse>, Status> {
        let devices = tokio::task::spawn_blocking(gpu_power::get_devices)
            .await
            .map_err(|e| Status::internal(format!("GPU device query failed: {e}")))?;
        Ok(Response::new(NvmlDevicesResponse { devices }))
    }

    async fn set_nvml_power_management_limit(
        &self,
        request: Request<NvmlPowerManagementLimitRequest>,
    ) -> Result<Response<NvmlPowerManagementLimitResponse>, Status> {
        let request = request.into_inner();
        let result = tokio::task::spawn_blocking(move || {
            gpu_power::set_power_management_limit(request.uuid, request.power_limit)
        })
        .await
        .map_err(|e| Status::internal(format!("GPU power limit task failed: {e}")))?;
        let success = result.is_ok();
        let error = result.err();
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
        let error = result.err();
        Ok(Response::new(SetMsiAfterburnerProfileResponse {
            success,
            error: error.map(|e| e.into()),
        }))
    }
}
