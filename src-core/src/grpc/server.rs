use super::models::oyasumi_core::{
    oyasumi_core_server::OyasumiCore, ElevatedSidecarStartArgs, Empty, OverlaySidecarStartArgs,
};
use log::error;
use tonic::{Request, Response, Status};

#[derive(Debug, Default)]
pub struct OyasumiCoreServerImpl {}

#[tonic::async_trait]
impl OyasumiCore for OyasumiCoreServerImpl {
    async fn on_overlay_sidecar_start(
        &self,
        request: Request<OverlaySidecarStartArgs>,
    ) -> Result<Response<Empty>, Status> {
        match crate::overlay_sidecar::handle_overlay_sidecar_start(request.get_ref()).await {
            Ok(_) => Ok(Response::new(Empty {})),
            Err(e) => {
                error!("[Core] Failed to handle overlay sidecar start: {}", e);
                Err(Status::internal("Failed to handle overlay sidecar start"))
            }
        }
    }

    async fn on_elevated_sidecar_start(
        &self,
        request: Request<ElevatedSidecarStartArgs>,
    ) -> Result<Response<Empty>, Status> {
        match crate::elevated_sidecar::handle_elevated_sidecar_start(request.get_ref()).await {
            Ok(_) => Ok(Response::new(Empty {})),
            Err(e) => {
                error!("[Core] Failed to handle elevated sidecar start: {}", e);
                Err(Status::internal("Failed to handle elevated sidecar start"))
            }
        }
    }
}
