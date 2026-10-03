// Paid packs, checked offline. A license is an Ed25519-signed payload made
// by the seller with scripts/license.mjs; the app holds only the public key,
// stores the accepted license text in the app data dir and re-verifies it on
// every check. No server, no account.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

/// Seller public key (base64url of the 32 raw bytes).
const PUBLIC_KEY: &str = "QXBvgMfLdd2xGVYkMApPwLIWeMY5YEE_7wjj0QcR3hk";
const PREFIX: &str = "OMOPET1-";
const MAX_LICENSE_FILE: u64 = 64 * 1024;
/// "My character" slots without the band pack.
pub const FREE_USER_SLOTS: usize = 1;

#[derive(Deserialize)]
struct Payload {
    v: u32,
    packs: Vec<String>,
    id: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct LicenseStatus {
    /// Paid packs this computer may use, e.g. ["band"].
    pub packs: Vec<String>,
    /// Buyer or batch reference from the license, shown in Settings.
    pub id: Option<String>,
}

impl LicenseStatus {
    pub fn has(&self, pack: &str) -> bool {
        self.packs.iter().any(|p| p == pack)
    }
}

/// Finds the first `OMOPET1-…` token in pasted text or a license file.
fn find_token(text: &str) -> Option<&str> {
    text.split(|c: char| c.is_whitespace())
        .find(|w| w.starts_with(PREFIX))
}

fn verify_with(text: &str, key: &VerifyingKey) -> Result<LicenseStatus, String> {
    let token = find_token(text).ok_or("license-invalid")?;
    let (payload_b64, sig_b64) = token[PREFIX.len()..]
        .split_once('.')
        .ok_or("license-invalid")?;
    let payload = URL_SAFE_NO_PAD.decode(payload_b64).map_err(|_| "license-invalid")?;
    let sig_bytes: [u8; 64] = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|_| "license-invalid")?
        .try_into()
        .map_err(|_| "license-invalid")?;
    key.verify_strict(&payload, &Signature::from_bytes(&sig_bytes))
        .map_err(|_| "license-invalid")?;
    let p: Payload = serde_json::from_slice(&payload).map_err(|_| "license-invalid")?;
    if p.v != 1 || p.packs.is_empty() {
        return Err("license-invalid".into());
    }
    Ok(LicenseStatus { packs: p.packs, id: Some(p.id) })
}

fn public_key() -> VerifyingKey {
    let bytes: [u8; 32] = URL_SAFE_NO_PAD
        .decode(PUBLIC_KEY)
        .expect("PUBLIC_KEY is base64url")
        .try_into()
        .expect("PUBLIC_KEY is 32 bytes");
    VerifyingKey::from_bytes(&bytes).expect("PUBLIC_KEY is a valid Ed25519 key")
}

pub fn verify(text: &str) -> Result<LicenseStatus, String> {
    verify_with(text, &public_key())
}

fn license_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(crate::packs::data_dir(app)?.join("license.txt"))
}

/// What this computer is entitled to; an unreadable or tampered file counts
/// as no license.
pub fn status<R: Runtime>(app: &AppHandle<R>) -> LicenseStatus {
    license_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| verify(&text).ok())
        .unwrap_or_default()
}

fn store<R: Runtime>(app: &AppHandle<R>, text: &str) -> Result<LicenseStatus, String> {
    let st = verify(text)?;
    let token = find_token(text).ok_or("license-invalid")?;
    let path = license_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, format!("{token}\n")).map_err(|e| e.to_string())?;
    Ok(st)
}

#[tauri::command]
pub fn license_status<R: Runtime>(app: AppHandle<R>) -> LicenseStatus {
    status(&app)
}

#[tauri::command]
pub fn license_activate<R: Runtime>(app: AppHandle<R>, text: String) -> Result<LicenseStatus, String> {
    store(&app, &text)
}

#[tauri::command]
pub fn license_import<R: Runtime>(app: AppHandle<R>, path: String) -> Result<LicenseStatus, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_LICENSE_FILE {
        return Err("license-invalid".into());
    }
    let text = std::fs::read_to_string(&path).map_err(|_| "license-invalid")?;
    store(&app, &text)
}

#[tauri::command]
pub fn license_remove<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    match std::fs::remove_file(license_path(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn issue(key: &SigningKey, payload: &str) -> String {
        let sig = key.sign(payload.as_bytes());
        format!(
            "{PREFIX}{}.{}",
            URL_SAFE_NO_PAD.encode(payload),
            URL_SAFE_NO_PAD.encode(sig.to_bytes())
        )
    }

    const BAND: &str = r#"{"v":1,"packs":["band"],"id":"buyer-1","iat":"2026-10-03"}"#;

    #[test]
    fn accepts_a_signed_license_inside_a_license_file() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let file = format!("# omo-pet license\n{}\n", issue(&key, BAND));
        let st = verify_with(&file, &key.verifying_key()).unwrap();
        assert!(st.has("band"));
        assert_eq!(st.id.as_deref(), Some("buyer-1"));
    }

    #[test]
    fn rejects_a_tampered_payload() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let good = issue(&key, BAND);
        let (_, sig) = good.split_once('.').unwrap();
        let forged = format!(
            "{PREFIX}{}.{sig}",
            URL_SAFE_NO_PAD.encode(r#"{"v":1,"packs":["band","season"],"id":"buyer-1"}"#)
        );
        assert!(verify_with(&forged, &key.verifying_key()).is_err());
    }

    #[test]
    fn rejects_a_license_signed_by_another_key() {
        let seller = SigningKey::from_bytes(&[7; 32]);
        let other = SigningKey::from_bytes(&[9; 32]);
        assert!(verify_with(&issue(&other, BAND), &seller.verifying_key()).is_err());
    }

    #[test]
    fn rejects_garbage() {
        let key = SigningKey::from_bytes(&[7; 32]);
        for text in ["", "hello", "OMOPET1-", "OMOPET1-abc.def", "OMOPET1-.."] {
            assert!(verify_with(text, &key.verifying_key()).is_err(), "{text}");
        }
    }

    #[test]
    fn the_shipped_public_key_is_valid() {
        let _ = public_key();
    }
}
