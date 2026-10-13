//! Real scripts for the shell: variables, loops, functions, `print`. The code runs in a JavaScript
//! engine on this side, never in the web view, and sees only what `script/runtime.js` hands it:
//! `db`, the BSON helpers and `print`. No files, no network but the connection of its tab.

pub mod commands;
mod engine;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use serde::Serialize;
use serde_json::Value;

/// The scripts that are running, each with the flag that stops it.
#[derive(Default)]
pub struct ScriptRuns(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl ScriptRuns {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn start(&self, run_id: &str) -> Arc<AtomicBool> {
        let stop = Arc::new(AtomicBool::new(false));
        self.lock().insert(run_id.to_owned(), stop.clone());
        stop
    }

    fn finish(&self, run_id: &str) {
        self.lock().remove(run_id);
    }

    /// Asks the script to stop; it does at its next step.
    fn stop(&self, run_id: &str) {
        if let Some(stop) = self.lock().get(run_id) {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

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
