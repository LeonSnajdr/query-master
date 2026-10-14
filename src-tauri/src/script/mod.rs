//! Real scripts for the shell: variables, loops, functions, `print`. The code runs in a JavaScript
//! engine on this side, never in the web view, and sees only what `script/runtime.js` hands it:
//! `db`, the BSON helpers and `print`. No files, no network but the connection of its tab.

pub mod commands;
mod engine;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    /// The last value of the script: the documents of a cursor, the elements of an array, or one
    /// value. Canonical extended JSON.
    pub items: Vec<Value>,
    /// The value had more items than are handed over.
    pub truncated: bool,
    /// What the script printed.
    pub output: String,
}
