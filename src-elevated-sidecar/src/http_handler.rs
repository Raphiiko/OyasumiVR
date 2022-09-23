use std::convert::Infallible;

use hyper::{body::Buf, Body, Method, Request, Response};
use oyasumi_shared::models::{
    NVMLSetPowerManagementLimitRequest, NVMLSetPowerManagementLimitResponse,
};

use crate::nvml;

pub async fn handle_http(req: Request<Body>) -> Result<Response<Body>, Infallible> {
    match (req.method(), req.uri().path()) {
        (&Method::GET, "/nvml/status") => handle_nvml_status(req).await,
        (&Method::GET, "/nvml/get_devices") => handle_nvml_get_devices(req).await,
        (&Method::POST, "/nvml/set_power_management_limit") => {
            handle_nvml_set_power_management_limit(req).await
        }
        _ => response_404(),
    }
}

pub async fn handle_nvml_status(_: Request<Body>) -> Result<Response<Body>, Infallible> {
    let status = nvml::nvml_status().await;
    Ok(Response::builder().status(200).body(status.into()).unwrap())
}

pub async fn handle_nvml_get_devices(_: Request<Body>) -> Result<Response<Body>, Infallible> {
    let devices = nvml::nvml_get_devices();
    Ok(Response::builder()
        .status(200)
        .body(serde_json::to_string(&devices).unwrap().into())
        .unwrap())
}

pub async fn handle_nvml_set_power_management_limit(
    req: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    let request_data: NVMLSetPowerManagementLimitRequest = serde_json::from_reader(
        hyper::body::to_bytes(req.into_body())
            .await
            .unwrap()
            .reader(),
    )
    .unwrap();
    let result = nvml::nvml_set_power_management_limit(request_data.uuid, request_data.limit).await;
    let success = match result {
        Ok(_) => true,
        Err(_) => false,
    };
    let error = match result {
        Ok(_) => None,
        Err(e) => Some(e),
    };
    Ok(Response::builder()
        .status(200)
        .body(
            serde_json::to_string(&NVMLSetPowerManagementLimitResponse { success, error })
                .unwrap()
                .into(),
        )
        .unwrap())
}

fn response_404() -> Result<Response<Body>, Infallible> {
    Ok(Response::builder()
        .status(404)
        .body("Oyasumi Elevated Sidecar HTTP Server".into())
        .unwrap())
}
