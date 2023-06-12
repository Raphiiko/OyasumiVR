use std::convert::Infallible;

use hyper::{body::Buf, Body, Method, Request, Response};
use oyasumivr_shared::models::{
    MSIAfterburnerSetProfileRequest, MSIAfterburnerSetProfileResponse,
    NVMLSetPowerManagementLimitRequest, NVMLSetPowerManagementLimitResponse,
};

use crate::{afterburner, nvml};

pub async fn handle_http(req: Request<Body>) -> Result<Response<Body>, Infallible> {
    match (req.method(), req.uri().path()) {
        (&Method::GET, "/nvml/status") => handle_nvml_status(req).await,
        (&Method::GET, "/nvml/get_devices") => handle_nvml_get_devices(req).await,
        (&Method::POST, "/nvml/set_power_management_limit") => {
            handle_nvml_set_power_management_limit(req).await
        }
        (&Method::POST, "/msi_afterburner/set_profile") => {
            handle_msi_afterburner_set_profile(req).await
        }
        _ => response_404(),
    }
}

async fn handle_nvml_status(_: Request<Body>) -> Result<Response<Body>, Infallible> {
    let status = nvml::nvml_status().await;
    Ok(Response::builder().status(200).body(status.into()).unwrap())
}

async fn handle_nvml_get_devices(_: Request<Body>) -> Result<Response<Body>, Infallible> {
    let devices = nvml::nvml_get_devices();
    Ok(Response::builder()
        .status(200)
        .body(serde_json::to_string(&devices).unwrap().into())
        .unwrap())
}

async fn handle_nvml_set_power_management_limit(
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
    let success = result.is_ok();
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

async fn handle_msi_afterburner_set_profile(
    req: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    let request_data: MSIAfterburnerSetProfileRequest = serde_json::from_reader(
        hyper::body::to_bytes(req.into_body())
            .await
            .unwrap()
            .reader(),
    )
    .unwrap();
    let result =
        afterburner::set_afterburner_profile(request_data.executable_path, request_data.profile);
    let success = result.is_ok();
    let error = match result {
        Ok(_) => None,
        Err(e) => Some(e),
    };
    Ok(Response::builder()
        .status(200)
        .body(
            serde_json::to_string(&MSIAfterburnerSetProfileResponse { success, error })
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
