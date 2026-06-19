//! Watches a Claude Code session transcript and streams newly appended lines to
//! the frontend. The tailing core (which complete lines were added since we last
//! read) is a pure function so it can be tested without touching the filesystem
//! or the notify watcher.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

/// Event name carrying freshly appended transcript lines (a `string[]`) to the
/// frontend.
const PROGRESS_EVENT: &str = "claude-progress:lines";

/// Splits out the complete lines that appear after `from_offset` (a byte index
/// into `contents`). A trailing line with no newline yet is left unconsumed, so
/// tailing a file mid-write never yields a half-written JSON line. Returns the
/// new lines and the byte offset to resume from next time.
pub fn split_new_lines(contents: &str, from_offset: usize) -> (Vec<String>, usize) {
    let start = if from_offset > contents.len() { 0 } else { from_offset };
    match contents[start..].rfind('\n') {
        Some(idx) => {
            let end = start + idx + 1;
            let lines = contents[start..end].lines().map(str::to_string).collect();
            (lines, end)
        }
        None => (Vec::new(), start),
    }
}

/// Read the file and return the lines appended since `from_offset`. A read error
/// (file missing, mid-rename) yields nothing and leaves the offset untouched.
fn read_new_lines(path: &PathBuf, from_offset: usize) -> (Vec<String>, usize) {
    match std::fs::read_to_string(path) {
        Ok(contents) => split_new_lines(&contents, from_offset),
        Err(_) => (Vec::new(), from_offset),
    }
}

/// Holds the active transcript watcher. Dropping the watcher (replacing it with
/// `None`) stops the OS-level subscription, so only one transcript is watched at
/// a time.
pub struct ClaudeProgressState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl ClaudeProgressState {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
        }
    }
}

impl Default for ClaudeProgressState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start streaming a session transcript to the frontend: emit everything already
/// in the file, then watch it and emit each batch of newly appended lines.
#[tauri::command]
pub fn claude_progress_watch(
    app: AppHandle,
    state: State<ClaudeProgressState>,
    path: String,
) -> Result<(), String> {
    let path = PathBuf::from(path);

    // Catch up on everything already written before watching for changes.
    let (initial_lines, initial_offset) = read_new_lines(&path, 0);
    if !initial_lines.is_empty() {
        let _ = app.emit(PROGRESS_EVENT, &initial_lines);
    }

    let app_cb = app.clone();
    let path_cb = path.clone();
    let offset = Arc::new(Mutex::new(initial_offset));

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_err() {
            return;
        }
        let mut offset = offset.lock().unwrap();
        let (lines, new_offset) = read_new_lines(&path_cb, *offset);
        *offset = new_offset;
        if !lines.is_empty() {
            let _ = app_cb.emit(PROGRESS_EVENT, &lines);
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

/// Stop streaming the current transcript (if any).
#[tauri::command]
pub fn claude_progress_unwatch(state: State<ClaudeProgressState>) {
    *state.watcher.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_complete_lines_and_leaves_a_partial_line_unconsumed() {
        let (lines, offset) = split_new_lines("a\nb\nc", 0);
        assert_eq!(lines, vec!["a", "b"]);
        assert_eq!(offset, 4);
    }

    #[test]
    fn resumes_from_the_offset_on_the_next_read() {
        let (lines, offset) = split_new_lines("a\nb\nc\nd\n", 4);
        assert_eq!(lines, vec!["c", "d"]);
        assert_eq!(offset, 8);
    }

    #[test]
    fn returns_nothing_when_there_is_no_complete_line_yet() {
        let (lines, offset) = split_new_lines("abc", 0);
        assert!(lines.is_empty());
        assert_eq!(offset, 0);
    }

    #[test]
    fn restarts_from_the_top_when_the_file_shrank() {
        let (lines, offset) = split_new_lines("x\n", 100);
        assert_eq!(lines, vec!["x"]);
        assert_eq!(offset, 2);
    }
}
