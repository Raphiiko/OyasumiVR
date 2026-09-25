use std::{path::PathBuf, process::ExitCode};

use oyasumivr_frame_helper::{bind, serve, INFO};

fn data_dir(argument: Option<String>) -> Option<PathBuf> {
    argument.map(PathBuf::from).or_else(|| {
        std::env::var_os("HOME")
            .map(|home| PathBuf::from(home).join(".local/share/oyasumivr_helper"))
    })
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("info") => {
            println!("{}", serde_json::to_string(&INFO).unwrap());
            ExitCode::SUCCESS
        }
        Some("serve") => {
            let Some(root) = data_dir(args.next()) else {
                eprintln!("HOME is not set");
                return ExitCode::FAILURE;
            };
            let result = match bind(&root).await {
                Ok((listener, acceptor)) => serve(root, listener, acceptor).await,
                Err(error) => Err(error),
            };
            if let Err(error) = result {
                eprintln!("{error}");
            }
            ExitCode::FAILURE
        }
        _ => {
            eprintln!("usage: oyasumivr-frame-helper info | serve [DATA_DIR]");
            ExitCode::FAILURE
        }
    }
}
