// The desktop shell: a window around the web app, plus two small native bits
// the web build can't do itself: Keychain storage for the session token, and
// opening links in the system browser (via tauri-plugin-opener). Updates come
// from tauri-plugin-updater, checked against the server's /api/desktop/latest.json.

const SERVICE: &str = "dog.doggynote.app";
const ACCOUNT: &str = "session";

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![get_token, set_token, clear_token, haptic])
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
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
