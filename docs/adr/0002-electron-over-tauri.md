# Electron rather than Tauri for the desktop shell

The app's core job is orchestrating many `gh` and `codex` child processes with progress, abort, timeouts and a shared concurrency cap. In Electron that logic runs in the Node main process in the same TypeScript as the rest of the codebase, shared with the headless CLI. In Tauri it would have to be written in Rust or delegated to a Node sidecar, which means two runtimes for one job. Tauri's advantages, smaller binaries and lower memory, matter little for a single-user resident tool. We chose Electron.

## Considered options

- Tauri: rejected for the reason above.
- A local Node server opened in a browser tab: rejected because a resident menu-bar presence, native notifications and scheduled refreshes need a long-lived app.
