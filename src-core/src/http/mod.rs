pub mod commands;

use hyper::{
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, Server,
};
use log::{error, info};
use std::{convert::Infallible, net::SocketAddr};
use tokio::sync::Mutex;

lazy_static! {
    pub static ref PORT: Mutex<Option<u32>> = Default::default();
}

pub async fn init() {
    // Start server
    info!("[Core] Starting HTTP server...");
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let make_svc =
        make_service_fn(|_conn| async { Ok::<_, Infallible>(service_fn(request_handler)) });
    let server = Server::bind(&addr).serve(make_svc);
    // Get port
    *PORT.lock().await = Some(server.local_addr().port() as u32);
    info!(
        "[Core] Started HTTP server on port {}",
        server.local_addr().port()
    );
    // Run server forever
    tokio::spawn(async move {
        if let Err(e) = server.await {
            error!("[Core] HTTP server error: {}", e);
        }
    });
}

async fn request_handler(req: Request<Body>) -> Result<Response<Body>, Infallible> {
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

fn response_404() -> Result<Response<Body>, Infallible> {
    Ok(Response::builder()
        .status(404)
        .body("OyasumiVR Main HTTP Server".into())
        .unwrap())
}

async fn handle_font_request(path: &str) -> Result<Response<Body>, Infallible> {
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
            .body("Requested invalid font".into())
            .unwrap());
    }
    // Determine font path
    let font_path = format!("resources/fonts/{}", font_name);
    // Check if font exists
    if !std::path::Path::new(&font_path).exists() {
        return Ok(Response::builder()
            .status(404)
            .body("Requested font does not exist".into())
            .unwrap());
    }
    // Load font
    let font_data = match std::fs::read(font_path) {
        Ok(data) => data,
        Err(_) => {
            return Ok(Response::builder()
                .status(500)
                .body("Requested font could not be served".into())
                .unwrap());
        }
    };
    // Serve font
    return Ok(Response::builder()
        .status(200)
        .header("Content-Type", "font/woff2")
        .header("Access-Control-Allow-Origin", "*")
        .body(font_data.into())
        .unwrap());
}
