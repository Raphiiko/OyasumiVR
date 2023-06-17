fn main() {
    tonic_build::configure()
        .compile(
            &[
                "../protobuf/oyasumi-core.proto",
                "../protobuf/notification.proto",
            ],
            &["../protobuf/"],
        )
        .unwrap();
    tauri_build::build()
}
