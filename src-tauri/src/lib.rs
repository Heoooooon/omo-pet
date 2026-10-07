use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, Wry};

mod creator;
mod license;
mod packs;
mod web_handoff;

/// A normal (layer-0) on-screen window, in logical screen points with the
/// origin at the top-left of the primary display — multiply by the monitor
/// scale factor to get physical pixels.
#[derive(Serialize, Clone)]
pub struct DesktopWindow {
    pub id: i64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
fn list_windows() -> Vec<DesktopWindow> {
    #[cfg(target_os = "macos")]
    {
        macos::list_windows()
    }
    #[cfg(target_os = "windows")]
    {
        win::list_windows()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::DesktopWindow;
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_graphics::geometry::CGRect;
    use core_graphics::window::{
        copy_window_info, kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly,
    };
    use std::ffi::c_void;

    pub fn list_windows() -> Vec<DesktopWindow> {
        let own_pid = std::process::id() as i64;
        let mut out = Vec::new();
        let list: CFArray<*const c_void> = match copy_window_info(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            0,
        ) {
            Some(list) => list,
            None => return out,
        };

        for item in list.iter() {
            let dict: CFDictionary<CFString, CFType> =
                unsafe { CFDictionary::wrap_under_get_rule(*item as CFDictionaryRef) };

            let num = |key: &str| -> Option<i64> {
                dict.find(CFString::new(key))
                    .and_then(|v| v.downcast::<CFNumber>())
                    .and_then(|n| n.to_i64())
            };

            if num("kCGWindowLayer").unwrap_or(-1) != 0 {
                continue;
            }
            if num("kCGWindowOwnerPID").unwrap_or(0) == own_pid {
                continue;
            }
            if num("kCGWindowAlpha").unwrap_or(1) == 0 {
                continue;
            }
            let Some(id) = num("kCGWindowNumber") else {
                continue;
            };
            let Some(bounds) = dict
                .find(CFString::new("kCGWindowBounds"))
                .and_then(|v| v.downcast::<CFDictionary>())
                .and_then(|d| CGRect::from_dict_representation(&d))
            else {
                continue;
            };

            // Ignore tiny utility windows and menu-bar popovers.
            if bounds.size.width < 160.0 || bounds.size.height < 90.0 {
                continue;
            }

            out.push(DesktopWindow {
                id,
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.size.width,
                height: bounds.size.height,
            });
        }
        out
    }
}

// NOTE: compiles but has not yet been exercised on a real Windows machine.
#[cfg(target_os = "windows")]
mod win {
    use super::DesktopWindow;
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowLongW, GetWindowTextLengthW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
    };

    // Shell surfaces that are technically visible top-level windows but must
    // never become platforms (wallpaper host, taskbars).
    const SHELL_CLASSES: [&str; 4] = [
        "Progman",
        "WorkerW",
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
    ];

    pub fn list_windows() -> Vec<DesktopWindow> {
        let mut out: Vec<DesktopWindow> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(enum_proc), LPARAM(&mut out as *mut _ as isize));
        }
        out
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<DesktopWindow>);

        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return TRUE;
        }
        // Untitled top-level windows are almost never real app windows.
        if GetWindowTextLengthW(hwnd) == 0 {
            return TRUE;
        }
        if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
            return TRUE;
        }
        // Cloaked = UWP shells and windows parked on other virtual desktops.
        let mut cloaked: u32 = 0;
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut _ as *mut _,
            std::mem::size_of::<u32>() as u32,
        )
        .is_ok()
            && cloaked != 0
        {
            return TRUE;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            return TRUE;
        }
        let mut class_buf = [0u16; 64];
        let len = GetClassNameW(hwnd, &mut class_buf) as usize;
        let class = String::from_utf16_lossy(&class_buf[..len]);
        if SHELL_CLASSES.contains(&class.as_str()) {
            return TRUE;
        }

        // The visible frame, without the invisible resize borders.
        let mut rect = RECT::default();
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut _ as *mut _,
            std::mem::size_of::<RECT>() as u32,
        )
        .is_err()
        {
            return TRUE;
        }

        // Same logical-point contract as the macOS list: physical pixels
        // divided by the window's own DPI scale.
        let k = GetDpiForWindow(hwnd) as f64 / 96.0;
        if k <= 0.0 {
            return TRUE;
        }
        let width = (rect.right - rect.left) as f64 / k;
        let height = (rect.bottom - rect.top) as f64 / k;
        if width < 160.0 || height < 90.0 {
            return TRUE;
        }
        out.push(DesktopWindow {
            id: hwnd.0 as i64,
            x: rect.left as f64 / k,
            y: rect.top as f64 / k,
            width,
            height,
        });
        TRUE
    }
}

// ---------- Lanbeam pet bridge (localhost) ----------
//
// The Lanbeam macOS Agent publishes a loopback-only HTTP listener whose port
// is written to ~/Library/Application Support/Lanbeam/pet-bridge.json.
// Through it the pet can hand itself off to the paired iPad and learn when
// it has been sent back.

fn bridge_port() -> Option<u16> {
    let home = std::env::var("HOME").ok()?;
    let path = format!("{home}/Library/Application Support/Lanbeam/pet-bridge.json");
    let data = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&data).ok()?;
    u16::try_from(value.get("port")?.as_u64()?).ok()
}

fn bridge_request(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::time::Duration;

    let port = bridge_port().ok_or("pet bridge unavailable")?;
    let mut stream = std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_secs(2),
    )
    .map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(3))).ok();

    let body = body.unwrap_or("");
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).map_err(|e| e.to_string())?;

    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|e| e.to_string())?;
    if !response.starts_with("HTTP/1.1 200") {
        return Err(format!(
            "bridge status: {}",
            response.lines().next().unwrap_or("<empty>")
        ));
    }
    response
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .ok_or_else(|| "malformed bridge response".into())
}

#[tauri::command]
async fn pet_bridge_state() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| bridge_request("GET", "/local/pet/state", None))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pet_bridge_handoff(to: String, entry_edge: String) -> Result<String, String> {
    if !matches!(to.as_str(), "mac" | "ios") || !matches!(entry_edge.as_str(), "left" | "right") {
        return Err("invalid handoff arguments".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let body = format!(r#"{{"to":"{to}","entryEdge":"{entry_edge}"}}"#);
        bridge_request("POST", "/local/pet/handoff", Some(&body))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pet_bridge_settings(
    size: f64,
    speed: f64,
    activity: f64,
    stunts: f64,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let body =
            format!(r#"{{"size":{size},"speed":{speed},"activity":{activity},"stunts":{stunts}}}"#);
        bridge_request("POST", "/local/pet/settings", Some(&body))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- click-through ----------
//
// A pet window is a 240x320 transparent box, but only the drawn character
// should take the mouse. While the window ignores cursor events the webview
// sees no mouse at all, so the cursor is followed here: whenever it is over a
// pet window (or just left it) that window gets its local point and decides,
// from the sprite's pixels, whether to keep taking clicks.

const CURSOR_POLL: std::time::Duration = std::time::Duration::from_millis(33);

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
struct PetCursor {
    x: f64,
    y: f64,
    inside: bool,
}

fn is_pet_window(label: &str) -> bool {
    label == "main" || label.starts_with("pet-")
}

/// The cursor in window-local logical points (whole points, so a resting
/// cursor sends nothing), or `inside: false` when it is outside the window.
fn local_cursor(cursor: (f64, f64), origin: (f64, f64), size: (f64, f64), scale: f64) -> PetCursor {
    let x = (cursor.0 - origin.0) / scale;
    let y = (cursor.1 - origin.1) / scale;
    if x < 0.0 || y < 0.0 || x >= size.0 / scale || y >= size.1 / scale {
        return PetCursor { x: -1.0, y: -1.0, inside: false };
    }
    PetCursor { x: x.floor(), y: y.floor(), inside: true }
}

fn spawn_cursor_watch(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last: std::collections::HashMap<String, PetCursor> = Default::default();
        loop {
            std::thread::sleep(CURSOR_POLL);
            let Ok(cursor) = app.cursor_position() else {
                continue;
            };
            let windows = app.webview_windows();
            last.retain(|label, _| windows.contains_key(label));
            for (label, window) in windows {
                if !is_pet_window(&label) {
                    continue;
                }
                let (Ok(origin), Ok(size), Ok(scale)) =
                    (window.outer_position(), window.outer_size(), window.scale_factor())
                else {
                    continue;
                };
                let now = local_cursor(
                    (cursor.x, cursor.y),
                    (origin.x as f64, origin.y as f64),
                    (size.width as f64, size.height as f64),
                    scale,
                );
                let before = last.insert(label.clone(), now);
                if before == Some(now) || (!now.inside && !before.is_some_and(|b| b.inside)) {
                    continue;
                }
                let _ = app.emit_to(label.as_str(), "pet-cursor", now);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_maps_into_logical_window_points() {
        let c = local_cursor((1100.0, 700.0), (1000.0, 600.0), (480.0, 640.0), 2.0);
        assert_eq!(c, PetCursor { x: 50.0, y: 50.0, inside: true });
        let edge = local_cursor((1479.0, 1239.0), (1000.0, 600.0), (480.0, 640.0), 2.0);
        assert_eq!(edge, PetCursor { x: 239.0, y: 319.0, inside: true });
    }

    #[test]
    fn cursor_outside_the_window_is_reported_as_outside() {
        for p in [(999.0, 700.0), (1480.0, 700.0), (1100.0, 599.0), (1100.0, 1240.0)] {
            assert!(!local_cursor(p, (1000.0, 600.0), (480.0, 640.0), 2.0).inside, "{p:?}");
        }
    }

    #[test]
    fn only_pet_windows_follow_the_cursor() {
        assert!(is_pet_window("main"));
        assert!(is_pet_window("pet-buddy-jabdori"));
        assert!(!is_pet_window("settings"));
        assert!(!is_pet_window("band-stage"));
    }
}

// ---------- tray ----------
//
// The pet can be hidden (iPad handoff, band show), so the tray is the one
// place that always offers the band, the settings and quitting. Labels
// follow the UI language the webviews pick (`set_tray_labels`).

struct TrayItems {
    band: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

#[tauri::command]
fn set_tray_labels(
    items: tauri::State<'_, TrayItems>,
    band: String,
    settings: String,
    quit: String,
) -> Result<(), String> {
    items.band.set_text(band).map_err(|e| e.to_string())?;
    items.settings.set_text(settings).map_err(|e| e.to_string())?;
    items.quit.set_text(quit).map_err(|e| e.to_string())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let band = MenuItem::with_id(app, "band", "Open band", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&band, &settings, &separator, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("omo-pet")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "band" => {
                let _ = app.emit_to("main", "band-open", ());
            }
            "settings" => {
                let _ = app.emit_to("main", "settings-open", ());
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(TrayItems { band, settings, quit });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("userpack", |ctx, request| {
            packs::serve(ctx.app_handle(), request.uri().path())
        })
        .setup(|app| {
            setup_tray(app)?;
            spawn_cursor_watch(app.handle().clone());
            let handoff = web_handoff::Shared::default();
            app.manage(handoff.clone());
            web_handoff::spawn(app.handle().clone(), handoff);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_windows,
            pet_bridge_state,
            pet_bridge_handoff,
            pet_bridge_settings,
            motion_tick,
            set_tray_labels,
            web_handoff::web_handoff_ready,
            web_handoff::web_view,
            web_handoff::web_handback,
            web_handoff::web_status,
            web_handoff::web_handback_cancel,
            packs::list_user_packs,
            packs::delete_user_pack,
            packs::import_pack,
            license::license_status,
            license::license_activate,
            license::license_import,
            license::license_remove,
            creator::creator_detect,
            creator::creator_grok_refresh,
            creator::creator_new_job,
            creator::creator_write,
            creator::creator_discard,
            creator::creator_save,
            creator::creator_grok_image,
            creator::creator_video_start,
            creator::creator_video_poll,
            creator::creator_codex_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// The desktop pet keeps moving when WebKit throttles background JS timers.
#[tauri::command]
async fn motion_tick(duration_ms: Option<u64>) {
    tokio::time::sleep(std::time::Duration::from_millis(duration_ms.unwrap_or(16))).await;
}
