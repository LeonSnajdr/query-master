//! Work that takes a while and can be stopped from the window: scripts and copies. Each run has an
//! id chosen by the frontend and a flag the work looks at between its steps.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use tauri::State;

#[derive(Default)]
pub struct Runs(Mutex<HashMap<String, Arc<AtomicBool>>>);

impl Runs {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Registers a run; it is stopped when the flag it gets turns true.
    pub(crate) fn start(&self, run_id: &str) -> Arc<AtomicBool> {
        let stop = Arc::new(AtomicBool::new(false));
        self.lock().insert(run_id.to_owned(), stop.clone());
        stop
    }

    pub(crate) fn finish(&self, run_id: &str) {
        self.lock().remove(run_id);
    }

    /// Asks the run to stop; it does at its next step.
    pub(crate) fn stop(&self, run_id: &str) {
        if let Some(stop) = self.lock().get(run_id) {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn run_stop(runs: State<'_, Runs>, run_id: String) {
    runs.stop(&run_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stops_only_the_run_named() {
        let runs = Runs::default();
        let first = runs.start("a");
        let second = runs.start("b");
        runs.stop("a");
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
        runs.finish("a");
        // A run that ended can no longer be stopped, and stopping it is no mistake.
        runs.stop("a");
    }
}
