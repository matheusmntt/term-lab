#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{Mutex, OnceLock},
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

// Integração com o zsh: um ZDOTDIR temporário carrega os dotfiles do usuário e,
// no fim do .zshrc, registra hooks que emitem sequências OSC:
//   OSC 133;C        -> comando começou a executar
//   OSC 133;D;<code> -> comando terminou (com exit code)
//   OSC 7            -> diretório atual
const ZSHENV: &str = r#"__tl_ours="$ZDOTDIR"
ZDOTDIR="$TERMLAB_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR="$__tl_ours"
unset __tl_ours
"#;

const ZPROFILE: &str = r#"__tl_ours="$ZDOTDIR"
ZDOTDIR="$TERMLAB_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zprofile" ]] && source "$ZDOTDIR/.zprofile"
ZDOTDIR="$__tl_ours"
unset __tl_ours
"#;

const ZSHRC: &str = r#"ZDOTDIR="$TERMLAB_USER_ZDOTDIR"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"

__termlab_preexec() { printf '\e]133;C\a' }
__termlab_precmd() {
  local c=$?
  printf '\e]133;D;%s\a' "$c"
  printf '\e]7;file://%s%s\a' "$HOST" "${PWD// /%20}"
}
autoload -Uz add-zsh-hook
add-zsh-hook preexec __termlab_preexec
add-zsh-hook precmd __termlab_precmd
precmd_functions=(__termlab_precmd ${precmd_functions:#__termlab_precmd})
"#;

static ZSH_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

fn zsh_integration_dir() -> Option<PathBuf> {
    ZSH_DIR
        .get_or_init(|| {
            let dir = std::env::temp_dir().join("termlab-zsh");
            fs::create_dir_all(&dir).ok()?;
            for (name, body) in [(".zshenv", ZSHENV), (".zprofile", ZPROFILE), (".zshrc", ZSHRC)] {
                fs::write(dir.join(name), body).ok()?;
            }
            Some(dir)
        })
        .clone()
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<Sessions>,
    id: u32,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let is_zsh = shell.ends_with("zsh");
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    cmd.env("TERM", "xterm-256color");

    if is_zsh {
        if let Some(dir) = zsh_integration_dir() {
            let user_zdotdir = std::env::var("ZDOTDIR")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_default();
            cmd.env("TERMLAB_USER_ZDOTDIR", user_zdotdir);
            cmd.env("ZDOTDIR", dir);
        }
    }

    let start_dir = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from));
    if let Some(dir) = start_dir {
        cmd.cwd(dir);
    }

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
