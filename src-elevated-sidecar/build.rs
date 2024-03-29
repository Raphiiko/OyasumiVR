fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=Cargo.lock");

    tonic_build::configure()
        // Make sure that enums generated by prost are serializable to be returnable from Tauri commands
        // Make sure that enums generated by prost are serializable to be returnable from Tauri commands
        // Structs
        .type_attribute(
            "NvmlDevice",
            "#[derive(serde::Serialize)] #[serde(rename_all = \"camelCase\")]",
        )
        // Enums
        .type_attribute("NvmlStatus", "#[derive(serde::Serialize)]")
        .type_attribute(
            "NvmlSetPowerManagementLimitError",
            "#[derive(serde::Serialize)]",
        )
        .type_attribute(
            "SetMsiAfterburnerProfileError",
            "#[derive(serde::Serialize)]",
        )
        // Compile protobuf files
        .compile(
            &[
                "../proto/oyasumi-core.proto",
                "../proto/elevated-sidecar.proto",
            ],
            &["../proto/"],
        )
        .unwrap();
}
