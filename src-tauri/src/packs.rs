// User character packs: made with "My character" or imported from a folder
// or zip. They live in the app data directory, never in the app bundle, and
// the webviews read them through the `userpack` URI scheme.
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

/// Sprite files a pack may ship, without the `.apng` extension.
pub const STATES: [&str; 11] = [
    "idle",
    "walk",
    "fall",
    "fall-open",
    "fall-glide",
    "fall-land",
    "edge",
    "rocket",
    "jet",
    "jet-climb",
    "play",
];
pub const INSTRUMENTS: [&str; 5] = ["vocal", "guitar", "bass", "drums", "keys"];
const MAX_FILE_BYTES: u64 = 40 * 1024 * 1024;
const MAX_PACK_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PackManifest {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instrument: Option<String>,
    /// Logical px the walk covers per 0.75 s at 100% size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stride: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

pub fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

pub fn packs_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("packs"))
}

pub fn jobs_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("creator-jobs"))
}

/// `idle.apng`, `walk.2.apng` … are accepted; anything else is not a sprite.
pub fn is_sprite_file(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".apng") else {
        return false;
    };
    let base = match stem.rsplit_once('.') {
        Some((base, variant)) if matches!(variant, "2" | "3" | "4") => base,
        _ => stem,
    };
    STATES.contains(&base)
}

pub fn safe_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !s.starts_with('.')
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').chars().take(24).collect::<String>();
    if out.is_empty() {
        // Names without ASCII letters (e.g. Hangul) get a time-based id.
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        format!("char-{millis:x}")
    } else {
        out
    }
}

/// A fresh `user-…` id that no existing pack uses.
pub fn new_pack_id<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<String, String> {
    let root = packs_root(app)?;
    let base = format!("user-{}", slug(name));
    let mut id = base.clone();
    let mut n = 2;
    while root.join(&id).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    Ok(id)
}

fn read_manifest(dir: &Path) -> Option<PackManifest> {
    let data = std::fs::read_to_string(dir.join("pack.json")).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn clean_manifest(mut m: PackManifest, id: &str) -> PackManifest {
    m.id = id.to_string();
    m.name = m.name.trim().chars().take(40).collect();
    if m.name.is_empty() {
        m.name = id.trim_start_matches("user-").to_string();
    }
    m.emoji = m.emoji.map(|e| e.chars().take(4).collect());
    if let Some(i) = &m.instrument {
        if !INSTRUMENTS.contains(&i.as_str()) {
            m.instrument = None;
        }
    }
    m.stride = m.stride.filter(|s| s.is_finite() && *s > 4.0 && *s < 400.0);
    m
}

pub fn write_manifest(dir: &Path, m: &PackManifest) -> Result<(), String> {
    let json = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("pack.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_user_packs<R: Runtime>(app: AppHandle<R>) -> Result<Vec<PackManifest>, String> {
    let root = packs_root(&app)?;
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        let Some(id) = dir.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if !id.starts_with("user-") || !dir.join("idle.apng").is_file() {
            continue;
        }
        if let Some(m) = read_manifest(&dir) {
            out.push(clean_manifest(m, &id));
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Free copies hold one "My character" pack; the band pack lifts the limit.
pub fn ensure_free_slot<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if crate::license::status(app).has("band") {
        return Ok(());
    }
    if list_user_packs(app.clone())?.len() >= crate::license::FREE_USER_SLOTS {
        return Err("slot-limit".into());
    }
    Ok(())
}

#[tauri::command]
pub fn delete_user_pack<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    if !id.starts_with("user-") || !safe_segment(&id) {
        return Err("invalid pack id".into());
    }
    let dir = packs_root(&app)?.join(&id);
    std::fs::remove_dir_all(dir).map_err(|e| e.to_string())
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
}

/// Import a pack in our format from a folder or a .zip: `<state>.apng`
/// sprites (idle required) plus an optional `pack.json`. Files may sit at the
/// top level or inside one folder; everything else is ignored.
#[tauri::command]
pub async fn import_pack<R: Runtime>(app: AppHandle<R>, path: String) -> Result<PackManifest, String> {
    tauri::async_runtime::spawn_blocking(move || import_pack_blocking(&app, Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

fn import_pack_blocking<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<PackManifest, String> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut manifest: Option<PackManifest> = None;
    let mut total = 0u64;
    let mut take = |name: &str, bytes: Vec<u8>, files: &mut Vec<(String, Vec<u8>)>| -> Result<(), String> {
        total += bytes.len() as u64;
        if total > MAX_PACK_BYTES {
            return Err("pack is larger than 200 MB".into());
        }
        if name == "pack.json" {
            manifest = serde_json::from_slice(&bytes).ok();
        } else if is_sprite_file(name) {
            if !is_png(&bytes) {
                return Err(format!("{name} is not an APNG/PNG file"));
            }
            files.push((name.to_string(), bytes));
        }
        Ok(())
    };

    let fallback_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("pack")
        .to_string();

    if path.is_dir() {
        // Top level, or the single sub-folder when the sprites sit one deeper.
        let mut dir = path.to_path_buf();
        if !dir.join("idle.apng").is_file() {
            let subs: Vec<PathBuf> = std::fs::read_dir(path)
                .map_err(|e| e.to_string())?
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.join("idle.apng").is_file())
                .collect();
            if subs.len() == 1 {
                dir = subs[0].clone();
            }
        }
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let p = entry.path();
            let Some(name) = p.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
                continue;
            };
            if !p.is_file() || !(name == "pack.json" || is_sprite_file(&name)) {
                continue;
            }
            if p.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
                return Err(format!("{name} is larger than 40 MB"));
            }
            let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
            take(&name, bytes, &mut files)?;
        }
    } else {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|_| "not a folder or a zip file".to_string())?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
            if entry.is_dir() {
                continue;
            }
            let Some(inner) = entry.enclosed_name() else {
                continue; // path traversal attempt
            };
            if inner.components().count() > 2 {
                continue;
            }
            let Some(name) = inner.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
                continue;
            };
            if !(name == "pack.json" || is_sprite_file(&name)) {
                continue;
            }
            if entry.size() > MAX_FILE_BYTES {
                return Err(format!("{name} is larger than 40 MB"));
            }
            let mut bytes = Vec::new();
            entry
                .by_ref()
                .take(MAX_FILE_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            take(&name, bytes, &mut files)?;
        }
    }

    if !files.iter().any(|(n, _)| n == "idle.apng") {
        return Err("no idle.apng found — a pack needs at least idle.apng".into());
    }
    let m = manifest.unwrap_or(PackManifest {
        id: String::new(),
        name: fallback_name,
        emoji: None,
        instrument: None,
        stride: None,
        source: None,
    });
    ensure_free_slot(app)?;
    let has_play = files.iter().any(|(n, _)| n == "play.apng");
    let id = new_pack_id(app, &m.name)?;
    let mut m = clean_manifest(m, &id);
    if !has_play {
        m.instrument = None; // cannot join the band without a play loop
    }
    m.source = Some("import".into());
    let dir = packs_root(app)?.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (name, bytes) in files {
        std::fs::write(dir.join(name), bytes).map_err(|e| e.to_string())?;
    }
    write_manifest(&dir, &m)?;
    Ok(m)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `userpack://localhost/<pack>/<file>` (packs) and
/// `userpack://localhost/_jobs/<job>/<file>` (character creator work files).
pub fn serve<R: Runtime>(app: &AppHandle<R>, uri_path: &str) -> tauri::http::Response<Vec<u8>> {
    let respond = |status: u16, mime: &str, body: Vec<u8>| {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", mime)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-cache")
            .body(body)
            .unwrap()
    };
    let path = percent_decode(uri_path.trim_start_matches('/'));
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let resolved = match segments.as_slice() {
        ["_jobs", job, file] if safe_segment(job) && safe_segment(file) => {
            jobs_root(app).map(|r| r.join(job).join(file))
        }
        ["_jobs", job, "pack", file] if safe_segment(job) && safe_segment(file) => {
            jobs_root(app).map(|r| r.join(job).join("pack").join(file))
        }
        [pack, file] if pack.starts_with("user-") && safe_segment(pack) && safe_segment(file) => {
            packs_root(app).map(|r| r.join(pack).join(file))
        }
        _ => return respond(400, "text/plain", b"bad path".to_vec()),
    };
    let Ok(file) = resolved else {
        return respond(500, "text/plain", b"no data dir".to_vec());
    };
    match std::fs::read(&file) {
        Ok(bytes) => {
            let mime = match file.extension().and_then(|e| e.to_str()) {
                Some("apng") | Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("webp") => "image/webp",
                Some("mp4") => "video/mp4",
                Some("json") => "application/json",
                _ => "application/octet-stream",
            };
            respond(200, mime, bytes)
        }
        Err(_) => respond(404, "text/plain", b"not found".to_vec()),
    }
}
