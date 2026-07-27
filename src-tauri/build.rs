fn main() {
    // Without this, cargo has no reason to know main.rs's `option_env!("WORSHIP_STUDIO_E2E_BUILD")`
    // depends on this var, so toggling it between an E2E build and a normal one (same source,
    // same cargo profile) could leave a stale cached binary with last build's baked-in value.
    println!("cargo:rerun-if-env-changed=WORSHIP_STUDIO_E2E_BUILD");
    tauri_build::build()
}
