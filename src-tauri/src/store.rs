//! Saved connections: name and address in a JSON file, the connection string (it may hold a
//! password) in the keychain of the operating system.

use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

const KEYCHAIN_SERVICE: &str = "QueryMaster";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// The connection string without credentials, to show in lists.
    pub address: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    /// Absent for a new connection.
    pub id: Option<String>,
    pub name: String,
    pub uri: String,
}

fn profiles_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_config_dir()?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("connections.json"))
}

fn read_profiles(app: &AppHandle) -> Result<Vec<Profile>> {
    let path = profiles_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path)?;
    serde_json::from_str(&text).map_err(|e| AppError::with_detail("error.backend.profiles", e))
}

fn write_profiles(app: &AppHandle, profiles: &[Profile]) -> Result<()> {
    let text = serde_json::to_string_pretty(profiles).map_err(AppError::raw)?;
    Ok(fs::write(profiles_path(app)?, text)?)
}

fn keychain(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, id).map_err(|e| AppError::with_detail("error.backend.keychain", e))
}

pub fn stored_uri(id: &str) -> Result<String> {
    keychain(id)?
        .get_password()
        .map_err(|e| AppError::with_detail("error.backend.keychainRead", e))
}

/// `mongodb://user:secret@host:27017/db?x=1` becomes `mongodb://host:27017/db`.
pub fn address_of(uri: &str) -> String {
    let (scheme, rest) = uri.split_once("://").unwrap_or(("mongodb", uri));
    let rest = rest.split('?').next().unwrap_or(rest);
    // Credentials end at the last `@` of the authority (a password may hold an encoded `/` only).
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let start = rest[..authority_end].rfind('@').map_or(0, |at| at + 1);
    format!("{scheme}://{}", rest[start..].trim_end_matches('/'))
}

#[tauri::command]
pub fn list_connections(app: AppHandle) -> Result<Vec<Profile>> {
    read_profiles(&app)
}

#[tauri::command]
pub fn connection_uri(id: String) -> Result<String> {
    stored_uri(&id)
}

#[tauri::command]
pub fn save_connection(app: AppHandle, input: ProfileInput) -> Result<Profile> {
    let uri = input.uri.trim();
    if !uri.starts_with("mongodb://") && !uri.starts_with("mongodb+srv://") {
        return Err(AppError::key("error.backend.uriScheme"));
    }
    let profile = Profile {
        id: input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        name: input.name.trim().to_string(),
        address: address_of(uri),
    };
    keychain(&profile.id)?
        .set_password(uri)
        .map_err(|e| AppError::with_detail("error.backend.keychainWrite", e))?;

    let mut profiles = read_profiles(&app)?;
    match profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(existing) => *existing = profile.clone(),
        None => profiles.push(profile.clone()),
    }
    write_profiles(&app, &profiles)?;
    Ok(profile)
}

#[tauri::command]
pub fn delete_connection(app: AppHandle, id: String) -> Result<()> {
    let mut profiles = read_profiles(&app)?;
    profiles.retain(|p| p.id != id);
    write_profiles(&app, &profiles)?;
    // A profile without keychain entry (removed by hand) is still deleted.
    match keychain(&id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::with_detail("error.backend.keychain", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::address_of;

    #[test]
    fn address_drops_credentials_and_options() {
        assert_eq!(address_of("mongodb://localhost:27017"), "mongodb://localhost:27017");
        assert_eq!(
            address_of("mongodb://user:p%40ss@a:1,b:2/shop?replicaSet=rs0"),
            "mongodb://a:1,b:2/shop"
        );
        assert_eq!(
            address_of("mongodb+srv://me:secret@cluster0.example.net/?retryWrites=true"),
            "mongodb+srv://cluster0.example.net"
        );
    }
}
