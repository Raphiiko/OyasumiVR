use std::{convert::Infallible, net::SocketAddr, thread};

use hyper::{
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, Server,
};
use log::{error, info};

use crate::{elevated_sidecar, IMAGE_CACHE, MAIN_HTTP_SERVER_PORT};

pub fn spawn_http_server_thread() {
    thread::spawn(move || {
        start_server();
    });
}

#[tokio::main]
async fn start_server() {
    // Start server
    info!("[Core] Starting HTTP server...");
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let make_svc =
        make_service_fn(|_conn| async { Ok::<_, Infallible>(service_fn(request_handler)) });
    let server = Server::bind(&addr).serve(make_svc);
    // Get port
    *MAIN_HTTP_SERVER_PORT.lock().unwrap() = Some(server.local_addr().port());
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
                let image_cache_guard = IMAGE_CACHE.lock().unwrap();
                image_cache = image_cache_guard.as_ref().unwrap().clone();
            }
            image_cache.clone().handle_request(req).await
        }
        (&Method::POST, "/elevated_sidecar/init") => {
            elevated_sidecar::handle_elevated_sidecar_init(req).await
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
