#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod menu;
mod shells;

use portable_pty::{native_pty_system, MasterPty, PtySize};
use serde_json::json;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::Mutex,
    thread,
};
use tauri::{AppHandle, Emitter, State};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
struct Sessions(Mutex<HashMap<u32, Session>>);

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<Sessions>,
    id: u32,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<(), String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let cmd = shells::build_shell_command(shell, cwd);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit("pty-output", json!({ "id": id, "data": &buf[..n] }));
                }
            }
        }
        let _ = app.emit("pty-exit", json!({ "id": id }));
    });

    state.0.lock().unwrap().insert(id, Session { master: pair.master, writer, child });
    Ok(())
}

#[tauri::command]
fn pty_write(state: State<Sessions>, id: u32, data: String) -> Result<(), String> {
    if let Some(s) = state.0.lock().unwrap().get_mut(&id) {
        s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(state: State<Sessions>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    if let Some(s) = state.0.lock().unwrap().get(&id) {
        s.master.resize(size(cols, rows)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_kill(state: State<Sessions>, id: u32) {
    if let Some(mut s) = state.0.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
}

/// Define o ícone do Dock em runtime (no `tauri dev` o app não está empacotado,
/// então o macOS mostraria o ícone genérico de executável).
#[cfg(target_os = "macos")]
fn set_dock_icon() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let Some(mtm) = MainThreadMarker::new() else { return };
    let data = NSData::with_bytes(include_bytes!("../icons/icon.png"));
    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image)) };
    }
}

fn main() {
    tauri::Builder::default()
        .menu(|app| menu::build_menu(app))
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().as_ref());
        })
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            set_dock_icon();
            Ok(())
        })
        .manage(Sessions::default())
        .invoke_handler(tauri::generate_handler![pty_spawn, pty_write, pty_resize, pty_kill])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Term Lab");
}
