fn main() {
    // Neither Tauri's own frontendDist embedding nor the rust-embed derive macro (RemoteAssets in
    // remote_server.rs, HelpAssets in lib.rs) emits its own cargo:rerun-if-changed — both just
    // read a folder at compile time with no built-in Cargo rebuild tracking (confirmed against
    // tauri-build's actual source and rust-embed's own docs, not assumed). Once a build script
    // emits ANY rerun-if-changed directive, cargo stops conservatively rerunning it on every
    // build and tracks ONLY the paths explicitly listed — so without these three, a CI run that
    // restores a cached target/ (Swatinem/rust-cache) and touches no Rust source can silently
    // ship an old embedded frontend/remote-control UI/help site, even though dist/, dist-remote/,
    // and resources/help/ were all freshly rebuilt by the same beforeBuildCommand run. Directory
    // paths are watched recursively by cargo, so one line per folder is enough.
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-changed=../dist-remote");
    println!("cargo:rerun-if-changed=resources/help");

    // `rerun-if-env-changed` alone only controls whether cargo re-invokes *this build script* —
    // it does not make cargo re-invoke rustc on lib.rs itself, and Tauri's multi-stage build
    // process doesn't reliably forward this ambient env var all the way to the specific rustc
    // invocation that compiles lib.rs (empirically confirmed: build.rs's own std::env::var saw
    // it fine while lib.rs's option_env! still baked in a stale value, producing a debug e2e
    // binary that still created the splash window it's supposed to skip). Explicitly forwarding
    // the value via `cargo:rustc-env` makes it part of cargo's own tracked build-script output,
    // which cargo *does* reliably diff and pass through to that crate's rustc invocation.
    println!("cargo:rerun-if-env-changed=WORSHIP_STUDIO_E2E_BUILD");
    if let Ok(value) = std::env::var("WORSHIP_STUDIO_E2E_BUILD") {
        println!("cargo:rustc-env=WORSHIP_STUDIO_E2E_BUILD={value}");
    }
    tauri_build::build()
}
