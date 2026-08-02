fn main() {
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
