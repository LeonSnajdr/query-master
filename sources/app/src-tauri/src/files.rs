//! Reading and writing the files the user picks in a file dialog (scripts, exports, imports).

use std::fs;

use crate::error::Result;

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String> {
    Ok(fs::read_to_string(path)?)
}

#[tauri::command]
pub fn write_text_file(path: String, text: String) -> Result<()> {
    Ok(fs::write(path, text)?)
}

/// A file as Base64, for a binary value of a document (*Open file* in the editor).
#[tauri::command]
pub fn read_base64_file(path: String) -> Result<String> {
    use base64::Engine as _;
    Ok(base64::engine::general_purpose::STANDARD.encode(fs::read(path)?))
}

/// Writes a binary value of a document, given as Base64, into a file (*Save file*).
#[tauri::command]
pub fn write_base64_file(path: String, data: String) -> Result<()> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|error| crate::error::Error::Script(error.to_string()))?;
    Ok(fs::write(path, bytes)?)
}
