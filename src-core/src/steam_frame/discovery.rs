use std::{
    collections::BTreeMap,
    net::{IpAddr, Ipv4Addr, SocketAddrV4},
    time::Duration,
};

use hickory_proto::{
    op::{Message, Query},
    rr::{Name, RData, RecordType},
};
use log::warn;
use serde::Serialize;
use tokio::{net::UdpSocket, time::Instant};

const SERVICE: &str = "_steamos-devkit._tcp.local.";
const MDNS_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Candidate {
    pub name: String,
    pub address: String,
}

fn query() -> Option<Vec<u8>> {
    let mut message = Message::query();
    message.add_query(Query::query(
        Name::from_ascii(SERVICE).ok()?,
        RecordType::PTR,
    ));
    message.to_vec().ok()
}

/// Returns the instance names a response advertises for the devkit service.
fn instance_names(response: &[u8]) -> Vec<String> {
    let Ok(message) = Message::from_vec(response) else {
        return Vec::new();
    };
    let service = Name::from_ascii(SERVICE).unwrap();
    message
        .answers
        .iter()
        .filter(|record| record.name == service)
        .filter_map(|record| match &record.data {
            RData::PTR(ptr) => ptr
                .0
                .iter()
                .next()
                .map(|label| String::from_utf8_lossy(label).into()),
            _ => None,
        })
        .collect()
}

/// Binds the mDNS port when it can, so answers sent to the multicast group arrive too. Other
/// mDNS listeners share the port through address reuse.
fn socket(interfaces: &[Ipv4Addr]) -> std::io::Result<UdpSocket> {
    let socket = socket2::Socket::new(
        socket2::Domain::IPV4,
        socket2::Type::DGRAM,
        Some(socket2::Protocol::UDP),
    )?;
    socket.set_reuse_address(true)?;
    if socket
        .bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 5353).into())
        .is_err()
    {
        socket.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0).into())?;
    }
    for interface in interfaces {
        if let Err(error) = socket.join_multicast_v4(&MDNS_GROUP, interface) {
            warn!("[SteamFrame] Could not browse on {interface}: {error}");
        }
    }
    socket.set_nonblocking(true)?;
    UdpSocket::from_std(socket.into())
}

/// Browses for devkit services for `duration`, sending the query on every IPv4 interface.
pub async fn discover(duration: Duration) -> Vec<Candidate> {
    let Some(query) = query() else {
        return Vec::new();
    };
    let interfaces: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|interface| !interface.is_loopback())
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(address) => Some(address),
            IpAddr::V6(_) => None,
        })
        .collect();
    let socket = match socket(&interfaces) {
        Ok(socket) => socket,
        Err(error) => {
            warn!("[SteamFrame] Could not open the mDNS socket: {error}");
            return Vec::new();
        }
    };
    for interface in &interfaces {
        if socket2::SockRef::from(&socket)
            .set_multicast_if_v4(interface)
            .is_ok()
        {
            let _ = socket.send_to(&query, (MDNS_GROUP, 5353)).await;
        }
    }
    let deadline = Instant::now() + duration;
    let mut found = BTreeMap::new();
    let mut buffer = [0u8; 9000];
    while let Ok(Ok((length, source))) =
        tokio::time::timeout_at(deadline, socket.recv_from(&mut buffer)).await
    {
        for name in instance_names(&buffer[..length]) {
            found.insert(source.ip().to_string(), name);
        }
    }
    found
        .into_iter()
        .map(|(address, name)| Candidate { name, address })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use hickory_proto::rr::{rdata::PTR, Record};

    #[test]
    fn reads_instance_names_from_answers() {
        let service = Name::from_ascii(SERVICE).unwrap();
        let instance = Name::from_ascii("frame._steamos-devkit._tcp.local.").unwrap();
        let other = Name::from_ascii("_http._tcp.local.").unwrap();
        let mut response = Message::response(1, hickory_proto::op::OpCode::Query);
        response.add_answer(Record::from_rdata(
            service,
            120,
            RData::PTR(PTR(instance.clone())),
        ));
        response.add_answer(Record::from_rdata(other, 120, RData::PTR(PTR(instance))));
        assert_eq!(instance_names(&response.to_vec().unwrap()), vec!["frame"]);
        assert!(instance_names(b"garbage").is_empty());
    }
}
