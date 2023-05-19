pub mod commands;

use hyper::{
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, Server,
};
use log::{error, info};
use std::{convert::Infallible, net::SocketAddr};
use tokio::sync::Mutex;

lazy_static! {
    pub static ref PORT: Mutex<Option<u16>> = Default::default();
}

pub async fn init() {
    // Start server
    info!("[Core] Starting HTTP server...");
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let make_svc =
        make_service_fn(|_conn| async { Ok::<_, Infallible>(service_fn(request_handler)) });
    let server = Server::bind(&addr).serve(make_svc);
    // Get port
    *PORT.lock().await = Some(server.local_addr().port());
    info!(
        "[Core] Started HTTP server on port {}",
        server.local_addr().port()
    );
    // Run server forever
    if let Err(e) = server.await {
        error!("[Core] HTTP server error: {}", e);
    }
}

async fn request_handler(req: Request<Body>) -> Result<Response<Body>, Infallible> {
    match (req.method(), req.uri().path()) {
        (&Method::GET, "/image_cache/get") => {
            let image_cache;
            {
                let image_cache_guard = crate::image_cache::INSTANCE.lock().await;
                image_cache = image_cache_guard.as_ref().unwrap().clone();
            }
            image_cache.clone().handle_request(req).await
        }
        (&Method::POST, "/elevated_sidecar/init") => {
            crate::elevated_sidecar::handle_elevated_sidecar_init(req).await
        }
        _ => response_404(),
    }
}

fn response_404() -> Result<Response<Body>, Infallible> {
    Ok(Response::builder()
        .status(404)
        .body("Oyasumi Main HTTP Server".into())
        .unwrap())
}
