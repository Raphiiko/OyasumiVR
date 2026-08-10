pub mod commands;

use bytes::Bytes;
use http_body_util::Full;
use hyper::{body::Incoming, server::conn::http1, service::service_fn, Method, Request, Response};
use hyper_util::rt::TokioIo;
use log::{error, info};
use std::{convert::Infallible, net::SocketAddr, sync::LazyLock};
use tokio::{net::TcpListener, sync::Mutex};

use crate::utils::models::CoreMode;

/// Body type used for all responses served by the main HTTP server.
pub type ResBody = Full<Bytes>;

pub static PORT: LazyLock<Mutex<Option<u32>>> = LazyLock::new(Default::default);

pub async fn init() {
    // Start server
    info!("[Core] Starting HTTP server...");
    let port: u16 = match crate::utils::cli_core_mode().await {
        CoreMode::Dev => crate::globals::CORE_HTTP_DEV_PORT,
        CoreMode::Release => 0,
    };
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
    // Bind first, so we can read back the actually bound port (the release mode port is ephemeral)
    let listener = TcpListener::bind(addr).await.unwrap();
    // Get port
    let local_port = listener.local_addr().unwrap().port();
    *PORT.lock().await = Some(local_port as u32);
    info!("[Core] Started HTTP server on port {local_port}");
    // Run server forever
    tokio::spawn(async move {
        loop {
            let stream = match listener.accept().await {
                Ok((stream, _)) => stream,
                Err(e) => {
                    error!("[Core] HTTP server error: {e}");
                    // Back off, so a persistent accept failure cannot busy-spin.
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    continue;
                }
            };
            tokio::spawn(async move {
                if let Err(e) = http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service_fn(request_handler))
                    .await
                {
                    error!("[Core] HTTP server error: {e}");
                }
            });
        }
    });
}

async fn request_handler(req: Request<Incoming>) -> Result<Response<ResBody>, Infallible> {
    let path = req.uri().path();
    // GET /image_cache/get
    if req.method() == Method::GET && path == "/image_cache/get" {
        let image_cache;
        {
            let image_cache_guard = crate::image_cache::INSTANCE.lock().await;
            image_cache = image_cache_guard.as_ref().unwrap().clone();
        }
        return image_cache.clone().handle_request(req).await;
    }
    // GET /font/<font_file>
    if req.method() == Method::GET && path.starts_with("/font/") {
        return handle_font_request(path).await;
    }
    response_404()
}

fn response_404() -> Result<Response<ResBody>, Infallible> {
    Ok(Response::builder()
        .status(404)
        .body("OyasumiVR Main HTTP Server".into())
        .unwrap())
}

async fn handle_font_request(path: &str) -> Result<Response<ResBody>, Infallible> {
    let font_name = path.strip_prefix("/font/").unwrap();
    // Check if font name is valid (alphanumeric with dashes
    if !font_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        || !font_name.ends_with(".woff2")
        || font_name.contains("..")
    {
        return Ok(Response::builder()
            .status(400)
            .header("Access-Control-Allow-Origin", "*")
            .body("Requested invalid font".into())
            .unwrap());
    }
    // Determine font path
    let font_path = format!("resources/fonts/{font_name}");
    // Check if font exists
    if !std::path::Path::new(&font_path).exists() {
        return Ok(Response::builder()
            .status(404)
            .header("Access-Control-Allow-Origin", "*")
            .body("Requested font does not exist".into())
            .unwrap());
    }
    // Load font
    let font_data = match std::fs::read(font_path) {
        Ok(data) => data,
        Err(_) => {
            return Ok(Response::builder()
                .status(500)
                .header("Access-Control-Allow-Origin", "*")
                .body("Requested font could not be served".into())
                .unwrap());
        }
    };
    // Serve font
    Ok(Response::builder()
        .status(200)
        .header("Content-Type", "font/woff2")
        .header("Access-Control-Allow-Origin", "*")
        .body(font_data.into())
        .unwrap())
}
