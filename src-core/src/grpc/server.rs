use super::models::oyasumi_core::{
    event_params::EventData, oyasumi_core_server::OyasumiCore, AddNotificationRequest,
    AddNotificationResponse, ElevatedSidecarStartArgs, Empty, EventParams, HttpServerPort,
    OverlaySidecarStartArgs,
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

    async fn send_event(&self, request: Request<EventParams>) -> Result<Response<Empty>, Status> {
        let request = request.get_ref();

        if let Some(data) = &request.event_data {
            match data {
                EventData::StringData(d) => {
                    crate::utils::send_event(request.event_name.as_str(), d.clone()).await;
                }
                EventData::BoolData(d) => {
                    crate::utils::send_event(request.event_name.as_str(), *d).await;
                }
                EventData::JsonData(d) => {
                    crate::utils::send_event(request.event_name.as_str(), d.clone()).await;
                }
                EventData::IntData(d) => {
                    crate::utils::send_event(request.event_name.as_str(), *d as f64).await;
                }
                EventData::DoubleData(d) => {
                    crate::utils::send_event(request.event_name.as_str(), *d).await;
                }
            }
        } else {
            crate::utils::send_event(request.event_name.as_str(), ()).await;
        }

        Ok(Response::new(Empty {}))
    }

    async fn get_http_server_port(
        &self,
        _: Request<Empty>,
    ) -> Result<Response<HttpServerPort>, Status> {
        let port = crate::http::PORT.lock().await;
        let port = port.as_ref().unwrap_or(&0);
        Ok(Response::new(HttpServerPort { port: *port }))
    }

    async fn add_notification(
        &self,
        request: Request<AddNotificationRequest>,
    ) -> Result<Response<AddNotificationResponse>, Status> {
        crate::utils::send_event("addNotification", request.get_ref().clone()).await;
        Ok(Response::new(AddNotificationResponse {
            notification_id: None, // TODO: IMPLEMENT METHOD TO RETRIEVE NOTIFICATION ID FROM FRONTEND
        }))
    }
}
