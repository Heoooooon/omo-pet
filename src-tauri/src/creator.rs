// "My character": turns one picture into a pack on this computer, using the
// user's own Grok login (stills + video) or Codex CLI (stills only). The
// login token is read here and never handed to the webview.
use crate::packs::{self, PackManifest};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{AppHandle, Runtime};

const XAI: &str = "https://api.x.ai/v1";
const IMAGE_MODEL: &str = "grok-imagine-image-2.0";
const VIDEO_MODEL: &str = "grok-imagine-video-1.5";

#[cfg(windows)]
const NO_WINDOW: u32 = 0x0800_0000;

fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(NO_WINDOW);
    }
    cmd
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn grok_home() -> Option<PathBuf> {
    match std::env::var_os("GROK_HOME") {
        Some(h) if !h.is_empty() => Some(PathBuf::from(h)),
        _ => home().map(|h| h.join(".grok")),
    }
}

fn grok_binary() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "grok.exe" } else { "grok" };
    if let Some(p) = grok_home().map(|h| h.join("bin").join(exe)).filter(|p| p.is_file()) {
        return Some(p);
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(exe))
        .find(|p| p.is_file())
}

/// Days-from-civil (Howard Hinnant) so RFC 3339 expiry needs no date crate.
fn unix_seconds(rfc3339: &str) -> Option<i64> {
    let b = rfc3339.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |r: std::ops::Range<usize>| rfc3339.get(r)?.parse::<i64>().ok();
    let (y, m, d) = (n(0..4)?, n(5..7)?, n(8..10)?);
    let (hh, mm, ss) = (n(11..13)?, n(14..16)?, n(17..19)?);
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + hh * 3600 + mm * 60 + ss)
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

enum Login {
    Missing,
    Unreadable,
    Expired,
    Valid(String),
}

fn grok_login() -> Login {
    let Some(path) = grok_home().map(|h| h.join("auth.json")) else {
        return Login::Missing;
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Login::Missing;
    };
    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&text) else {
        return Login::Unreadable;
    };
    let entries: Vec<&Value> = map.values().filter(|v| v.is_object()).collect();
    if entries.len() != 1 {
        return Login::Unreadable;
    }
    let Some(token) = entries[0].get("key").and_then(Value::as_str).filter(|t| !t.is_empty()) else {
        return Login::Unreadable;
    };
    if let Some(exp) = entries[0].get("expires_at").and_then(Value::as_str) {
        if unix_seconds(exp).is_some_and(|t| t <= now_seconds() + 60) {
            return Login::Expired;
        }
    }
    Login::Valid(token.to_string())
}

fn codex_command() -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", "codex"]);
        c
    } else {
        Command::new("codex")
    }
}

#[derive(Serialize)]
pub struct ToolStatus {
    grok_installed: bool,
    /// "ok" | "expired" | "missing" | "unreadable"
    grok_login: &'static str,
    codex_installed: bool,
    codex_logged_in: bool,
}

#[tauri::command]
pub async fn creator_detect() -> ToolStatus {
    tauri::async_runtime::spawn_blocking(|| {
        let grok_login = match grok_login() {
            Login::Valid(_) => "ok",
            Login::Expired => "expired",
            Login::Missing => "missing",
            Login::Unreadable => "unreadable",
        };
        let codex_installed = quiet(codex_command().arg("--version"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        let codex_logged_in = codex_installed
            && quiet(codex_command().args(["login", "status"]))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success());
        ToolStatus {
            grok_installed: grok_binary().is_some(),
            grok_login,
            codex_installed,
            codex_logged_in,
        }
    })
    .await
    .unwrap_or(ToolStatus {
        grok_installed: false,
        grok_login: "missing",
        codex_installed: false,
        codex_logged_in: false,
    })
}

/// An expired login is renewed by the CLI's own non-agent round trip
/// (`grok models`), run from an empty folder so nothing of the user's is in reach.
#[tauri::command]
pub async fn creator_grok_refresh() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bin = grok_binary().ok_or("grok CLI not found")?;
        let dir = std::env::temp_dir().join(format!("omo-pet-grok-{}", now_seconds()));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let status = quiet(Command::new(bin).arg("models").current_dir(&dir))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| e.to_string());
        let _ = std::fs::remove_dir_all(&dir);
        match (status?, grok_login()) {
            (_, Login::Valid(_)) => Ok(()),
            _ => Err("grok login could not be renewed — run `grok login`".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

fn job_dir<R: Runtime>(app: &AppHandle<R>, job: &str) -> Result<PathBuf, String> {
    if !packs::safe_segment(job) {
        return Err("invalid job".into());
    }
    Ok(packs::jobs_root(app)?.join(job))
}

fn job_file<R: Runtime>(app: &AppHandle<R>, job: &str, name: &str) -> Result<PathBuf, String> {
    let (sub, file) = match name.split_once('/') {
        Some(("pack", f)) => (Some("pack"), f),
        Some(_) => return Err("invalid file".into()),
        None => (None, name),
    };
    if !packs::safe_segment(file) {
        return Err("invalid file".into());
    }
    let dir = job_dir(app, job)?;
    Ok(match sub {
        Some(s) => dir.join(s).join(file),
        None => dir.join(file),
    })
}

#[tauri::command]
pub fn creator_new_job<R: Runtime>(app: AppHandle<R>, source: String) -> Result<String, String> {
    let src = Path::new(&source);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp"))
        .ok_or("choose a PNG, JPEG or WebP picture")?;
    if src.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > 20 * 1024 * 1024 {
        return Err("the picture is larger than 20 MB".into());
    }
    let job = format!("job-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0));
    let dir = job_dir(&app, &job)?;
    std::fs::create_dir_all(dir.join("pack")).map_err(|e| e.to_string())?;
    std::fs::copy(src, dir.join(format!("source.{ext}"))).map_err(|e| e.to_string())?;
    Ok(format!("{job}/source.{ext}"))
}

#[tauri::command]
pub fn creator_write<R: Runtime>(app: AppHandle<R>, job: String, name: String, base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(|e| e.to_string())?;
    let path = job_file(&app, &job, &name)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn creator_discard<R: Runtime>(app: AppHandle<R>, job: String) -> Result<(), String> {
    let dir = job_dir(&app, &job)?;
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn creator_save<R: Runtime>(app: AppHandle<R>, job: String, manifest: PackManifest) -> Result<PackManifest, String> {
    let src = job_dir(&app, &job)?.join("pack");
    if !src.join("idle.apng").is_file() {
        return Err("the pack has no idle.apng yet".into());
    }
    packs::ensure_free_slot(&app)?;
    let id = packs::new_pack_id(&app, &manifest.name)?;
    let mut m = packs::clean_manifest(manifest, &id);
    m.source = Some("custom".into());
    let dest = packs::packs_root(&app)?.join(&id);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(&src).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if packs::is_sprite_file(&name) {
            std::fs::copy(entry.path(), dest.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    if !dest.join("play.apng").is_file() {
        m.instrument = None;
    }
    packs::write_manifest(&dest, &m)?;
    let _ = std::fs::remove_dir_all(job_dir(&app, &job)?);
    Ok(m)
}

fn token() -> Result<String, String> {
    match grok_login() {
        Login::Valid(t) => Ok(t),
        Login::Expired => Err("grok-expired".into()),
        _ => Err("grok-missing".into()),
    }
}

fn data_url(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let mime = if bytes.starts_with(&[0xff, 0xd8]) {
        "image/jpeg"
    } else if bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else {
        "image/png"
    };
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout(Duration::from_secs(240))
        .build()
}

/// Never echo the request (it holds the token); keep the server's message.
fn http_error(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| {
                    v.get("error")
                        .and_then(|e| e.as_str().map(str::to_string).or_else(|| e.get("message").and_then(Value::as_str).map(str::to_string)))
                        .or_else(|| v.get("message").and_then(Value::as_str).map(str::to_string))
                })
                .unwrap_or_else(|| body.chars().take(200).collect());
            if code == 401 || code == 403 {
                format!("grok-auth: HTTP {code} {msg}")
            } else {
                format!("HTTP {code} {msg}")
            }
        }
        ureq::Error::Transport(t) => format!("network: {t}"),
    }
}

#[tauri::command]
pub async fn creator_grok_image<R: Runtime>(
    app: AppHandle<R>,
    job: String,
    prompt: String,
    refs: Vec<String>,
    out: String,
) -> Result<(), String> {
    let refs: Vec<PathBuf> = refs
        .iter()
        .map(|r| job_file(&app, &job, r))
        .collect::<Result<_, _>>()?;
    let out = job_file(&app, &job, &out)?;
    tauri::async_runtime::spawn_blocking(move || {
        let token = token()?;
        let images: Vec<Value> = refs
            .iter()
            .map(|p| data_url(p).map(|url| json!({ "type": "image_url", "url": url })))
            .collect::<Result<_, _>>()?;
        let mut body = json!({ "model": IMAGE_MODEL, "prompt": prompt, "n": 1, "response_format": "b64_json" });
        match images.len() {
            0 => {}
            1 => body["image"] = images[0].clone(),
            _ => body["images"] = Value::Array(images),
        }
        let endpoint = if refs.is_empty() { "generations" } else { "edits" };
        let reply: Value = agent()
            .post(&format!("{XAI}/images/{endpoint}"))
            .set("Authorization", &format!("Bearer {token}"))
            .send_json(body)
            .map_err(http_error)?
            .into_json()
            .map_err(|e| e.to_string())?;
        let b64 = reply["data"][0]["b64_json"]
            .as_str()
            .ok_or("the image service returned no image (it may have refused the picture)")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| e.to_string())?;
        std::fs::write(out, bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn creator_video_start<R: Runtime>(
    app: AppHandle<R>,
    job: String,
    prompt: String,
    image: String,
    last_frame: Option<String>,
    duration: u32,
) -> Result<String, String> {
    let image = job_file(&app, &job, &image)?;
    let last = last_frame.map(|f| job_file(&app, &job, &f)).transpose()?;
    tauri::async_runtime::spawn_blocking(move || {
        let token = token()?;
        let mut body = json!({
            "model": VIDEO_MODEL,
            "prompt": prompt,
            "duration": duration.clamp(1, 8),
            "resolution": "720p",
            "image": { "url": data_url(&image)? },
            "generate_audio": false,
        });
        if let Some(last) = last {
            body["last_frame"] = json!({ "url": data_url(&last)? });
        }
        let reply: Value = agent()
            .post(&format!("{XAI}/videos/generations"))
            .set("Authorization", &format!("Bearer {token}"))
            .send_json(body)
            .map_err(http_error)?
            .into_json()
            .map_err(|e| e.to_string())?;
        reply["request_id"]
            .as_str()
            .or_else(|| reply["id"].as_str())
            .map(str::to_string)
            .ok_or_else(|| "the video service returned no request id".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct VideoPoll {
    status: String,
    done: bool,
    failed: bool,
    message: Option<String>,
}

/// Poll once; when the clip is ready it is downloaded to `out` in the job.
#[tauri::command]
pub async fn creator_video_poll<R: Runtime>(
    app: AppHandle<R>,
    job: String,
    request: String,
    out: String,
) -> Result<VideoPoll, String> {
    if !request.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid request id".into());
    }
    let out = job_file(&app, &job, &out)?;
    tauri::async_runtime::spawn_blocking(move || {
        let token = token()?;
        let reply: Value = agent()
            .get(&format!("{XAI}/videos/{request}"))
            .set("Authorization", &format!("Bearer {token}"))
            .call()
            .map_err(http_error)?
            .into_json()
            .map_err(|e| e.to_string())?;
        let status = reply["status"].as_str().unwrap_or("pending").to_string();
        if matches!(status.as_str(), "failed" | "error" | "expired") {
            let message = reply["error"]["message"]
                .as_str()
                .or_else(|| reply["error"].as_str())
                .map(str::to_string);
            return Ok(VideoPoll { status, done: false, failed: true, message });
        }
        if !matches!(status.as_str(), "done" | "complete" | "completed") {
            return Ok(VideoPoll { status, done: false, failed: false, message: None });
        }
        if reply["video"]["respect_moderation"] == Value::Bool(false) {
            return Ok(VideoPoll {
                status,
                done: false,
                failed: true,
                message: Some("the video was blocked by the service's content rules".into()),
            });
        }
        let url = reply["video"]["url"].as_str().ok_or("finished without a video url")?;
        let download = |auth: bool| {
            let mut req = agent().get(url);
            if auth {
                req = req.set("Authorization", &format!("Bearer {token}"));
            }
            req.call()
        };
        let resp = match download(false) {
            Err(ureq::Error::Status(401 | 403, _)) => download(true),
            other => other,
        }
        .map_err(http_error)?;
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut resp.into_reader(), &mut bytes).map_err(|e| e.to_string())?;
        if bytes.get(4..8) != Some(b"ftyp") {
            return Err("the downloaded clip is not an mp4".into());
        }
        std::fs::write(out, bytes).map_err(|e| e.to_string())?;
        Ok(VideoPoll { status, done: true, failed: false, message: None })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stills through Codex CLI's image_gen tool (the user's ChatGPT login).
#[tauri::command]
pub async fn creator_codex_image<R: Runtime>(
    app: AppHandle<R>,
    job: String,
    prompt: String,
    refs: Vec<String>,
    out: String,
) -> Result<(), String> {
    let dir = job_dir(&app, &job)?;
    for r in refs.iter().chain(std::iter::once(&out)) {
        job_file(&app, &job, r)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = codex_command();
        cmd.args(["exec", "--skip-git-repo-check", "--sandbox", "workspace-write"]);
        for r in &refs {
            cmd.args(["-i", r]);
        }
        cmd.arg("-");
        let mut child = quiet(&mut cmd)
            .current_dir(&dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("codex could not start: {e}"))?;
        let instruction = format!(
            "Use your image_gen tool exactly once to create this picture, using the attached image(s) as the character reference. \
             Save the final PNG as ./{out} in the current folder and do nothing else.\n\nPicture: {prompt}\n"
        );
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(instruction.as_bytes()).map_err(|e| e.to_string())?;
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if dir.join(&out).is_file() {
            return Ok(());
        }
        let err = String::from_utf8_lossy(&output.stderr);
        if err.contains("401") || err.contains("refresh") {
            return Err("codex-auth: run `codex login` again".into());
        }
        Err("codex finished without saving the picture".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
