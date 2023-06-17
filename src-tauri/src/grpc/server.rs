use tonic::{transport::Server, Request, Response, Status};

use oyasumi_core::oyasumi_core_server::{OyasumiCore, OyasumiCoreServer};
use oyasumi_core::{ElevatedSidecarStartArgs, Empty, OverlaySidecarStartArgs};

pub mod oyasumi_core {
    tonic::include_proto!("oyasumi_core");
}

#[derive(Debug, Default)]
pub struct OyasumiCoreServer {}

#[tonic::async_trait]
impl OyasumiCore for OyasumiCoreServer {
    async fn OnOverlaySidecarStart(
        &self,
        request: Request<OverlaySidecarStartArgs>,
    ) -> Result<Response<Empty>, Status> {
        println!("Got a request: {:?}", request);
        Ok(Response::new(Empty {}))
    }
}
