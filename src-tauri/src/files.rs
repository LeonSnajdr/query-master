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
