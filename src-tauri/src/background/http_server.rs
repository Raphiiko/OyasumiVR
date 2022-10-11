use std::{convert::Infallible, net::SocketAddr, thread};

use hyper::{
    service::{make_service_fn, service_fn},
    Body, Method, Request, Response, Server,
};

use crate::{elevated_sidecar, MAIN_HTTP_SERVER_PORT};

pub fn spawn_http_server_thread() {
    thread::spawn(move || {
        start_server();
    });
}

#[tokio::main]
async fn start_server() {
    // Start server
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let make_svc =
        make_service_fn(|_conn| async { Ok::<_, Infallible>(service_fn(request_handler)) });
    let server = Server::bind(&addr).serve(make_svc);
    // Get port
    *MAIN_HTTP_SERVER_PORT.lock().unwrap() = Some(server.local_addr().port());
    // Run server forever
    if let Err(e) = server.await {
        eprintln!("http server error: {}", e);
    }
}

async fn request_handler(req: Request<Body>) -> Result<Response<Body>, Infallible> {
    match (req.method(), req.uri().path()) {
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
