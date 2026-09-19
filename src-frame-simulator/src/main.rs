use oyasumivr_frame_simulator::simulator::Simulator;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() > 3 {
        return Err(
            "usage: oyasumivr-frame-simulator [http-port] [wss-port] [loopback-ipv4]".into(),
        );
    }
    let http = args
        .first()
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(32000);
    let wss = args.get(1).map(|s| s.parse()).transpose()?.unwrap_or(32001);
    let sim = Simulator::default();
    let address = args
        .get(2)
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(std::net::Ipv4Addr::LOCALHOST);
    let running = sim.start_on(address, http, wss).await?;
    println!("Disposable local simulator. No discovery broadcasts or telemetry.");
    println!(
        "Devkit http://{}; companion wss://{}/companion",
        running.http, running.companion
    );
    println!(
        "Use python control.py for pairing and failure controls. Ctrl+C stops both listeners."
    );
    tokio::signal::ctrl_c().await?;
    running.stop().await;
    Ok(())
}
