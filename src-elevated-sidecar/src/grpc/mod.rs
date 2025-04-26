use log::{error, info};
use oyasumi_elevated_sidecar::oyasumi_elevated_sidecar_server::OyasumiElevatedSidecarServer;
use server::OyasumiElevatedSidecarServerImpl;
use std::net::SocketAddr;
use tokio::sync::Mutex;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::transport::Server;

mod server;
pub mod oyasumi_core {
    tonic::include_proto!("oyasumi_core");
}
pub mod oyasumi_elevated_sidecar {
    tonic::include_proto!("oyasumi_elevated_sidecar");
}

lazy_static! {
    pub static ref SERVER_PORT: Mutex<Option<u32>> = Default::default();
    pub static ref SERVER_WEB_PORT: Mutex<Option<u32>> = Default::default();
}

pub async fn init_server() -> u16 {
    info!("[Core] Starting gRPC server");
    let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!("[Core] Failed to bind gRPC server: {}", e);
            return 0;
        }
    };
    let server = Server::builder().add_service(OyasumiElevatedSidecarServer::new(
        OyasumiElevatedSidecarServerImpl::default(),
    ));
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            error!("[Core] Failed to get gRPC server port: {}", e);
            return 0;
        }
    };
    info!("[Core] gRPC server listening on port {}", port);
    *SERVER_PORT.lock().await = Some(port as u32);
    tokio::spawn(async move {
        let stream = TcpListenerStream::new(listener);
        if let Err(e) = server.serve_with_incoming(stream).await {
            error!("[Core] Failed to start gRPC server: {}", e);
        };
    });
    port
}

pub async fn init_web_server() -> u16 {
    info!("[Core] Starting gRPC server");
    let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!("[Core] Failed to bind gRPC-Web server: {}", e);
            return 0;
        }
    };
    let server =
        Server::builder()
            .accept_http1(true)
            .add_service(OyasumiElevatedSidecarServer::new(
                OyasumiElevatedSidecarServerImpl::default(),
            ));
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            error!("[Core] Failed to get gRPC-Web server port: {}", e);
            return 0;
        }
    };
    info!("[Core] gRPC-Web server listening on port {}", port);
    *SERVER_PORT.lock().await = Some(port as u32);
    tokio::spawn(async move {
        let stream = TcpListenerStream::new(listener);
        if let Err(e) = server.serve_with_incoming(stream).await {
            error!("[Core] Failed to start gRPC-Web server: {}", e);
        };
    });
    port
}
