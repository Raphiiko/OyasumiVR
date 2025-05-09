use crate::utils::models::CoreMode;
use log::{error, info};
use models::oyasumi_core::oyasumi_core_server::OyasumiCoreServer;
use server::OyasumiCoreServerImpl;
use std::net::SocketAddr;
use tokio::sync::Mutex;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::transport::Server;

pub mod commands;
mod server;

pub mod models {
    pub mod oyasumi_core {
        tonic::include_proto!("oyasumi_core");
    }

    pub mod elevated_sidecar {
        tonic::include_proto!("oyasumi_elevated_sidecar");
    }

    pub mod overlay_sidecar {
        tonic::include_proto!("oyasumi_overlay_sidecar");
    }
}

lazy_static! {
    pub static ref SERVER_PORT: Mutex<Option<u32>> = Default::default();
    pub static ref SERVER_WEB_PORT: Mutex<Option<u32>> = Default::default();
}

pub async fn init_server() -> u16 {
    info!("[Core] Starting gRPC server");
    let port: u16 = match crate::utils::cli_core_mode().await {
        CoreMode::Dev => crate::globals::CORE_GRPC_DEV_PORT,
        CoreMode::Release => 0,
    };
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
    info!("[Core] Starting gRPC server on {}", addr);
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!("[Core] Failed to bind gRPC server: {}", e);
            return 0;
        }
    };
    let server =
        Server::builder().add_service(OyasumiCoreServer::new(OyasumiCoreServerImpl::default()));
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
    let server = Server::builder()
        .accept_http1(true)
        .add_service(OyasumiCoreServer::new(OyasumiCoreServerImpl::default()));
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            error!("[Core] Failed to get gRPC-Web server port: {}", e);
            return 0;
        }
    };
    info!("[Core] gRPC-Web server listening on port {}", port);
    *SERVER_WEB_PORT.lock().await = Some(port as u32);
    tokio::spawn(async move {
        let stream = TcpListenerStream::new(listener);
        if let Err(e) = server.serve_with_incoming(stream).await {
            error!("[Core] Failed to start gRPC-Web server: {}", e);
        };
    });
    port
}
