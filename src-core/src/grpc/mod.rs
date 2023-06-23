use log::{error, info};
use models::oyasumi_core::oyasumi_core_server::OyasumiCoreServer;
use server::OyasumiCoreServerImpl;
use std::net::SocketAddr;
use tokio::sync::Mutex;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::transport::Server;

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
}

pub async fn init() {
    info!("[Core] Starting gRPC server");
    let addr: SocketAddr = "127.0.0.1:0".parse().unwrap();
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!("[Core] Failed to bind gRPC server: {}", e);
            return;
        }
    };
    let server =
        Server::builder().add_service(OyasumiCoreServer::new(OyasumiCoreServerImpl::default()));
    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            error!("[Core] Failed to get gRPC server port: {}", e);
            return;
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
}
