fn main() {
    // Only run Tauri's build-time codegen when building the GUI app. The headless
    // `train` binary builds with `--no-default-features`, where tauri is absent and
    // calling tauri_build::build() (which expects tauri.conf.json + a frontend dist)
    // would fail. Cargo exposes enabled features to build scripts as CARGO_FEATURE_*.
    if std::env::var_os("CARGO_FEATURE_GUI").is_some() {
        tauri_build::build();
    }
}
