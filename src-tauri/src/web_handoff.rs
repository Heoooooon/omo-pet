// ---------- web overlay handoff (localhost) ----------
//
// The web overlay (src/overlay) runs the same pet inside a browser tab. When
// she walks off the side of the page, the tab tells this app where on screen
// that was and the desktop pet carries on from the same spot; dropping the
// desktop pet back inside that browser window hands her back to the tab.
//
// A tiny HTTP listener on 127.0.0.1 only. There is no token: it is a local
// toy channel, so it refuses every request whose Origin is not one of the
// pages we serve the overlay on, and every Host other than the loopback
// address (DNS rebinding). The worst a page could do is move the pet.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

pub const PORT: u16 = 47838;
const MAX_HEAD: usize = 8 * 1024;
const MAX_BODY: usize = 4 * 1024;
/// The tab polls every second while the desktop holds the pet.
const FRESH: Duration = Duration::from_secs(4);
const ALIVE: Duration = Duration::from_secs(8);

const ALLOWED_ORIGINS: [&str; 1] = ["https://kakao.cmore.dev"];
const LOOPBACK_ORIGINS: [&str; 2] = ["http://localhost", "http://127.0.0.1"];

/// Logical screen points, origin at the primary display's top-left —
/// the same space as `list_windows` and Chrome's `window.screenX`.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq)]
pub struct ScreenRect {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Arrival {
    pub tab: String,
    pub pack: String,
    pub state: String,
    pub dir: i8,
    /// Where she crossed the page edge: her center x and feet line.
    pub x: f64,
    pub feet_y: f64,
    pub view: ScreenRect,
}

#[derive(Deserialize)]
struct SyncBody {
    tab: String,
    view: ScreenRect,
}

/// Where the desktop pet re-enters the tab, in screen points.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub x: f64,
    pub feet_y: f64,
    pub dir: i8,
    pub state: String,
}

#[derive(Default)]
pub struct Handoff {
    /// The main pet is on screen and may take a pet from the web.
    ready: bool,
    /// The tab that last handed the pet over (or took her back).
    tab: Option<String>,
    view: Option<ScreenRect>,
    seen: Option<Instant>,
    /// The desktop holds the pet that came from `tab`.
    holding: bool,
    /// A hand-back waiting for `tab` to collect it.
    back: Option<Entry>,
}

pub type Shared = Arc<Mutex<Handoff>>;

impl Handoff {
    fn fresh(&self, within: Duration) -> bool {
        self.seen.is_some_and(|t| t.elapsed() < within)
    }
}

pub fn origin_allowed(origin: &str) -> bool {
    if ALLOWED_ORIGINS.contains(&origin) {
        return true;
    }
    LOOPBACK_ORIGINS.iter().any(|base| {
        origin == *base
            || origin
                .strip_prefix(base)
                .and_then(|rest| rest.strip_prefix(':'))
                .is_some_and(|port| !port.is_empty() && port.len() <= 5 && port.bytes().all(|b| b.is_ascii_digit()))
    })
}

pub fn host_allowed(host: &str, port: u16) -> bool {
    host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_rect(r: &ScreenRect) -> bool {
    [r.left, r.top, r.right, r.bottom].iter().all(|v| v.is_finite() && v.abs() < 100_000.0)
        && r.right > r.left
        && r.bottom > r.top
}

fn valid_arrival(a: &Arrival) -> bool {
    valid_id(&a.tab)
        && valid_id(&a.pack)
        && matches!(a.state.as_str(), "walk" | "jet")
        && (a.dir == 1 || a.dir == -1)
        && a.x.is_finite()
        && a.feet_y.is_finite()
        && a.x.abs() < 100_000.0
        && a.feet_y.abs() < 100_000.0
        && valid_rect(&a.view)
}

pub struct Response {
    pub status: u16,
    pub body: String,
    /// A pet to show on the desktop, emitted after the reply is built.
    pub arrival: Option<Arrival>,
}

fn reply(status: u16, body: impl Into<String>) -> Response {
    Response { status, body: body.into(), arrival: None }
}

/// Everything except the socket: decides the reply for one request.
pub fn route(
    shared: &Shared,
    method: &str,
    path: &str,
    origin: Option<&str>,
    host: Option<&str>,
    body: &[u8],
) -> Response {
    if !host.is_some_and(|h| host_allowed(h, PORT)) {
        return reply(403, r#"{"error":"host"}"#);
    }
    if !origin.is_some_and(origin_allowed) {
        return reply(403, r#"{"error":"origin"}"#);
    }
    if method == "OPTIONS" {
        return reply(204, "");
    }
    let mut st = shared.lock().unwrap_or_else(|e| e.into_inner());
    match (method, path) {
        ("GET", "/omopet/v1/hello") => {
            reply(200, format!(r#"{{"app":"omo-pet","ready":{}}}"#, st.ready))
        }
        ("POST", "/omopet/v1/arrive") => {
            let Ok(a) = serde_json::from_slice::<Arrival>(body) else {
                return reply(400, r#"{"error":"body"}"#);
            };
            if !valid_arrival(&a) {
                return reply(400, r#"{"error":"body"}"#);
            }
            if !st.ready {
                return reply(409, r#"{"error":"busy"}"#);
            }
            st.tab = Some(a.tab.clone());
            st.view = Some(a.view);
            st.seen = Some(Instant::now());
            st.holding = true;
            st.back = None;
            Response { status: 200, body: r#"{"ok":true}"#.into(), arrival: Some(a) }
        }
        ("POST", "/omopet/v1/sync") => {
            let Ok(s) = serde_json::from_slice::<SyncBody>(body) else {
                return reply(400, r#"{"error":"body"}"#);
            };
            if !valid_id(&s.tab) || !valid_rect(&s.view) {
                return reply(400, r#"{"error":"body"}"#);
            }
            if st.tab.as_deref() != Some(s.tab.as_str()) {
                // Not ours (another tab, or the app restarted): the tab keeps her.
                return reply(200, r#"{"location":"none"}"#);
            }
            st.seen = Some(Instant::now());
            st.view = Some(s.view);
            if let Some(entry) = st.back.take() {
                st.holding = false;
                let entry = serde_json::to_string(&entry).unwrap_or_default();
                return reply(200, format!(r#"{{"location":"web","entry":{entry}}}"#));
            }
            let location = if st.holding { "desktop" } else { "web" };
            reply(200, format!(r#"{{"location":"{location}"}}"#))
        }
        _ => reply(404, r#"{"error":"not found"}"#),
    }
}

fn status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        _ => "Error",
    }
}

fn read_request(stream: &mut TcpStream) -> Option<(String, String, Vec<(String, String)>, Vec<u8>)> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return None;
        }
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = std::str::from_utf8(&buf[..head_end]).ok()?;
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let len: usize = headers
        .iter()
        .find(|(k, _)| k == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    if len > MAX_BODY {
        return None;
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    Some((method, path, headers, body))
}

fn serve_one(app: &tauri::AppHandle, shared: &Shared, mut stream: TcpStream) {
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(2))).ok();
    let Some((method, path, headers, body)) = read_request(&mut stream) else {
        return;
    };
    let header = |name: &str| headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str());
    let origin = header("origin");
    let res = route(shared, &method, &path, origin, header("host"), &body);
    let mut out = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        res.status,
        status_text(res.status),
        res.body.len()
    );
    if res.status != 403 {
        if let Some(o) = origin {
            out.push_str(&format!(
                "Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\n"
            ));
        }
    }
    out.push_str("\r\n");
    out.push_str(&res.body);
    let _ = stream.write_all(out.as_bytes());
    if let Some(a) = res.arrival {
        let _ = app.emit_to("main", "web-arrive", a);
    }
}

pub fn spawn(app: tauri::AppHandle, shared: Shared) {
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("web handoff listener unavailable on 127.0.0.1:{PORT}: {e}");
                return;
            }
        };
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let shared = shared.clone();
            std::thread::spawn(move || serve_one(&app, &shared, stream));
        }
    });
}

fn state(app: &tauri::AppHandle) -> Shared {
    app.state::<Shared>().inner().clone()
}

#[tauri::command]
pub fn web_handoff_ready(app: tauri::AppHandle, ready: bool) {
    state(&app).lock().unwrap_or_else(|e| e.into_inner()).ready = ready;
}

/// The browser window the desktop pet came from, while its tab still polls.
#[tauri::command]
pub fn web_view(app: tauri::AppHandle) -> Option<ScreenRect> {
    let st = state(&app);
    let st = st.lock().unwrap_or_else(|e| e.into_inner());
    if st.holding && st.fresh(FRESH) {
        st.view
    } else {
        None
    }
}

/// Offer the pet back to the tab; it collects her on its next poll.
#[tauri::command]
pub fn web_handback(app: tauri::AppHandle, entry: Entry) -> bool {
    let st = state(&app);
    let mut st = st.lock().unwrap_or_else(|e| e.into_inner());
    if !st.holding || !st.fresh(FRESH) || st.back.is_some() {
        return false;
    }
    st.back = Some(entry);
    true
}

#[derive(Serialize)]
pub struct WebStatus {
    pending: bool,
    alive: bool,
}

#[tauri::command]
pub fn web_status(app: tauri::AppHandle) -> WebStatus {
    let st = state(&app);
    let st = st.lock().unwrap_or_else(|e| e.into_inner());
    WebStatus { pending: st.back.is_some(), alive: st.fresh(ALIVE) }
}

/// Withdraw a hand-back nobody collected. False when the tab already took her.
#[tauri::command]
pub fn web_handback_cancel(app: tauri::AppHandle) -> bool {
    let st = state(&app);
    let mut st = st.lock().unwrap_or_else(|e| e.into_inner());
    st.back.take().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOST: &str = "127.0.0.1:47838";
    const LOCAL: &str = "http://localhost:5173";

    fn shared(ready: bool) -> Shared {
        Arc::new(Mutex::new(Handoff { ready, ..Default::default() }))
    }

    fn arrive_body(tab: &str) -> String {
        format!(
            r#"{{"tab":"{tab}","pack":"omo","state":"walk","dir":1,"x":1200,"feetY":800,"view":{{"left":0,"top":80,"right":1200,"bottom":900}}}}"#
        )
    }

    fn sync(s: &Shared, tab: &str) -> Response {
        let body = format!(r#"{{"tab":"{tab}","view":{{"left":0,"top":80,"right":1200,"bottom":900}}}}"#);
        route(s, "POST", "/omopet/v1/sync", Some(LOCAL), Some(HOST), body.as_bytes())
    }

    #[test]
    fn only_our_pages_and_loopback_origins_are_allowed() {
        for ok in ["https://kakao.cmore.dev", "http://localhost", "http://localhost:47950", "http://127.0.0.1:8080"] {
            assert!(origin_allowed(ok), "{ok}");
        }
        for bad in [
            "https://evil.example",
            "http://kakao.cmore.dev",
            "https://kakao.cmore.dev.evil.example",
            "http://localhost.evil.example",
            "http://localhost:80x",
            "http://127.0.0.1:",
            "null",
        ] {
            assert!(!origin_allowed(bad), "{bad}");
        }
    }

    #[test]
    fn foreign_origin_or_host_is_refused_before_anything_happens() {
        let s = shared(true);
        let body = arrive_body("t1");
        let evil = route(&s, "POST", "/omopet/v1/arrive", Some("https://evil.example"), Some(HOST), body.as_bytes());
        assert_eq!(evil.status, 403);
        let no_origin = route(&s, "POST", "/omopet/v1/arrive", None, Some(HOST), body.as_bytes());
        assert_eq!(no_origin.status, 403);
        let rebound = route(&s, "POST", "/omopet/v1/arrive", Some(LOCAL), Some("evil.example:47838"), body.as_bytes());
        assert_eq!(rebound.status, 403);
        assert!(evil.arrival.is_none() && no_origin.arrival.is_none() && rebound.arrival.is_none());
        assert!(!s.lock().unwrap().holding);
    }

    #[test]
    fn arrival_is_refused_while_the_desktop_pet_is_busy() {
        let s = shared(false);
        let r = route(&s, "POST", "/omopet/v1/arrive", Some(LOCAL), Some(HOST), arrive_body("t1").as_bytes());
        assert_eq!(r.status, 409);
        assert!(r.arrival.is_none());
    }

    #[test]
    fn malformed_arrivals_are_rejected() {
        let s = shared(true);
        for body in [
            "not json".to_string(),
            arrive_body("t1").replace(r#""dir":1"#, r#""dir":3"#),
            arrive_body("t1").replace(r#""walk""#, r#""teleport""#),
            arrive_body("../etc"),
            arrive_body("t1").replace(r#""right":1200"#, r#""right":-5"#),
        ] {
            let r = route(&s, "POST", "/omopet/v1/arrive", Some(LOCAL), Some(HOST), body.as_bytes());
            assert_eq!(r.status, 400, "{body}");
        }
    }

    #[test]
    fn the_pet_goes_to_the_desktop_and_back_to_the_same_tab_only() {
        let s = shared(true);
        let r = route(&s, "POST", "/omopet/v1/arrive", Some(LOCAL), Some(HOST), arrive_body("t1").as_bytes());
        assert_eq!(r.status, 200);
        assert_eq!(r.arrival.as_ref().map(|a| (a.dir, a.x)), Some((1, 1200.0)));
        assert!(sync(&s, "t1").body.contains(r#""location":"desktop""#));
        assert!(sync(&s, "other").body.contains(r#""location":"none""#));

        s.lock().unwrap().back = Some(Entry { x: 1100.0, feet_y: 700.0, dir: -1, state: "walk".into() });
        assert!(sync(&s, "other").body.contains("none"), "another tab cannot take her");
        let back = sync(&s, "t1");
        assert!(back.body.contains(r#""location":"web""#) && back.body.contains(r#""feetY":700"#), "{}", back.body);
        assert!(!s.lock().unwrap().holding);
        assert!(!sync(&s, "t1").body.contains("entry"), "collected exactly once");
    }

    #[test]
    fn preflight_answers_without_touching_state() {
        let s = shared(true);
        let r = route(&s, "OPTIONS", "/omopet/v1/arrive", Some(LOCAL), Some(HOST), b"");
        assert_eq!(r.status, 204);
        assert!(!s.lock().unwrap().holding);
    }
}
