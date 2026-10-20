// The desktop shell: a window around the web app, plus two small native bits
// the web build can't do itself: Keychain storage for the session token, and
// opening links in the system browser (via tauri-plugin-opener), and saving
// exported PNGs through the native Save dialog. Updates come
// from tauri-plugin-updater, checked against the server's /api/desktop/latest.json.

const SERVICE: &str = "dog.doggynote.app";
const ACCOUNT: &str = "session";

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct SaveBeforeExit {
  ready: AtomicBool,
  pending: AtomicBool,
  listening: AtomicBool,
}

#[tauri::command]
fn exit_save_ready(app: tauri::AppHandle) {
  app.state::<SaveBeforeExit>().listening.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn finish_exit_save(app: tauri::AppHandle, allow: bool) {
  let state = app.state::<SaveBeforeExit>();
  state.pending.store(false, Ordering::SeqCst);
  if allow {
    state.ready.store(true, Ordering::SeqCst);
    app.exit(0);
  }
}

fn request_exit_save(app: &tauri::AppHandle) {
  let state = app.state::<SaveBeforeExit>();
  if !state.pending.swap(true, Ordering::SeqCst) {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.show();
      let _ = window.set_focus();
      if window.emit("save-before-exit", ()).is_err() {
        state.pending.store(false, Ordering::SeqCst);
      }
    }
  }
}

fn entry() -> Result<keyring::Entry, String> {
  keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_token() -> Result<Option<String>, String> {
  match entry()?.get_password() {
    Ok(t) => Ok(Some(t)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
fn set_token(token: String) -> Result<(), String> {
  entry()?.set_password(&token).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_token() -> Result<(), String> {
  match entry()?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

/// A light trackpad "tick" (the alignment pattern) when a dragged card snaps
/// to a new grid point. AppKit wants this on the main thread.
#[tauri::command]
fn haptic(app: tauri::AppHandle) {
  #[cfg(target_os = "macos")]
  {
    let _ = app.run_on_main_thread(|| {
      use objc2_app_kit::{NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime, NSHapticFeedbackPerformer};
      NSHapticFeedbackManager::defaultPerformer()
        .performFeedbackPattern_performanceTime(NSHapticFeedbackPattern::Alignment, NSHapticFeedbackPerformanceTime::Now);
    });
  }
  #[cfg(not(target_os = "macos"))]
  let _ = app;
}

/// Save an exported PNG: the bytes arrive as the raw IPC body, the suggested
/// file name in the `x-name` header. Shows the native Save dialog; returns the
/// chosen path, or None if cancelled.
#[tauri::command]
async fn save_png(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
  use tauri_plugin_dialog::DialogExt;
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
    return Err("expected raw PNG bytes".into());
  };
  let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("board.png").to_string();
  let Some(path) = app.dialog().file().add_filter("PNG image", &["png"]).set_file_name(&name).blocking_save_file() else {
    return Ok(None);
  };
  let path = path.into_path().map_err(|e| e.to_string())?;
  std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
  Ok(Some(path.display().to_string()))
}

#[tauri::command]
async fn save_recovery(app: tauri::AppHandle, json: String) -> Result<Option<String>, String> {
  use tauri_plugin_dialog::DialogExt;
  let Some(path) = app.dialog().file().add_filter("JSON recovery copy", &["json"])
    .set_file_name("doggynote-unsynced-changes.json").blocking_save_file() else { return Ok(None); };
  let path = path.into_path().map_err(|e| e.to_string())?;
  std::fs::write(&path, json.as_bytes()).map_err(|e| e.to_string())?;
  Ok(Some(path.display().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(SaveBeforeExit::default())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![get_token, set_token, clear_token, haptic, save_png, save_recovery, exit_save_ready, finish_exit_save])
    .on_window_event(|window, event| {
      if window.label() != "main" { return; }
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let state = window.state::<SaveBeforeExit>();
        if state.listening.load(Ordering::SeqCst) && !state.ready.load(Ordering::SeqCst) {
          api.prevent_close();
          request_exit_save(window.app_handle());
        }
      }
    })
    .setup(|app| {
      // ⌃⌥Space from anywhere: toggle the quick-capture window (Toy box).
      #[cfg(desktop)]
      {
        use tauri::Manager;
        use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
        let capture = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
        app.handle().plugin(
          tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
              if shortcut != &capture || event.state() != ShortcutState::Pressed {
                return;
              }
              if let Some(w) = app.get_webview_window("capture") {
                if w.is_visible().unwrap_or(false) {
                  let _ = w.hide();
                } else {
                  let _ = w.center();
                  let _ = w.show();
                  let _ = w.set_focus();
                }
              }
            })
            .build(),
        )?;
        // Another app may already own the shortcut; capture still works from the app itself.
        if let Err(e) = app.global_shortcut().register(capture) {
          log::warn!("quick-capture shortcut unavailable: {e}");
        }
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
        let state = app.state::<SaveBeforeExit>();
        // Updater restarts explicitly save before requesting a coded exit.
        if code.is_none() && state.listening.load(Ordering::SeqCst) && !state.ready.load(Ordering::SeqCst) {
          api.prevent_exit();
          request_exit_save(app);
        }
      }
    });
}
