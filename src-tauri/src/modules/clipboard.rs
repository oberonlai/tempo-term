use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

#[tauri::command]
pub fn terminal_clipboard_image_paths() -> Result<Vec<String>, String> {
    clipboard_image_paths()
}

#[tauri::command]
pub fn terminal_clipboard_text() -> Result<String, String> {
    clipboard_text()
}

#[tauri::command]
pub fn terminal_prepare_clipboard_image_attachment(path: String) -> Result<(), String> {
    prepare_clipboard_image_attachment(Path::new(&path))
}

#[cfg(target_os = "macos")]
fn clipboard_image_paths() -> Result<Vec<String>, String> {
    let image_paths: Vec<String> = macos_clipboard_file_paths()?
        .into_iter()
        .filter(|path| is_image_path(Path::new(path)))
        .collect();
    if !image_paths.is_empty() {
        return Ok(image_paths);
    }

    let target = unique_temp_image_path("png")?;
    if macos_write_clipboard_png(&target)? {
        Ok(vec![path_to_string(target)])
    } else {
        Ok(Vec::new())
    }
}

#[cfg(not(target_os = "macos"))]
fn clipboard_image_paths() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "macos")]
fn clipboard_text() -> Result<String, String> {
    let output = Command::new("pbpaste")
        .output()
        .map_err(|e| format!("failed to run pbpaste: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(not(target_os = "macos"))]
fn clipboard_text() -> Result<String, String> {
    Ok(String::new())
}

#[cfg(target_os = "macos")]
fn prepare_clipboard_image_attachment(path: &Path) -> Result<(), String> {
    if !is_image_path(path) {
        return Err("clipboard path is not a supported image".to_string());
    }
    let png_path = if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
    {
        path.to_path_buf()
    } else {
        let target = unique_temp_image_path("png")?;
        let output = Command::new("sips")
            .arg("-s")
            .arg("format")
            .arg("png")
            .arg(path)
            .arg("--out")
            .arg(&target)
            .output()
            .map_err(|e| format!("failed to run sips: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        target
    };
    macos_set_clipboard_png(&png_path)
}

#[cfg(not(target_os = "macos"))]
fn prepare_clipboard_image_attachment(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_clipboard_file_paths() -> Result<Vec<String>, String> {
    let script = r#"
set oldDelimiters to AppleScript's text item delimiters
set AppleScript's text item delimiters to linefeed
try
  set outputPaths to {}
  try
    set end of outputPaths to POSIX path of (the clipboard as alias)
  end try
  try
    set end of outputPaths to POSIX path of (the clipboard as «class furl»)
  end try
  try
    set copiedItems to the clipboard as list
    repeat with copiedItem in copiedItems
      try
        set end of outputPaths to POSIX path of copiedItem
      end try
    end repeat
  end try
  set resultText to outputPaths as text
on error
  set resultText to ""
end try
set AppleScript's text item delimiters to oldDelimiters
return resultText
"#;
    let output = run_osascript(script)?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

#[cfg(target_os = "macos")]
fn macos_set_clipboard_png(path: &Path) -> Result<(), String> {
    let script = format!(
        r#"
try
  set imageData to read (POSIX file "{}") as «class PNGf»
  set the clipboard to imageData
  return "ok"
on error err
  return err
end try
"#,
        applescript_string(path)
    );
    let output = run_osascript(&script)?;
    if output.trim() == "ok" {
        Ok(())
    } else {
        Err(output)
    }
}

#[cfg(target_os = "macos")]
fn macos_write_clipboard_png(path: &Path) -> Result<bool, String> {
    let script = format!(
        r#"
try
  set imageData to the clipboard as «class PNGf»
  set outputFile to POSIX file "{}"
  set fileRef to open for access outputFile with write permission
  set eof fileRef to 0
  write imageData to fileRef
  close access fileRef
  return "ok"
on error
  try
    close access outputFile
  end try
  return ""
end try
"#,
        applescript_string(path)
    );
    let output = run_osascript(&script)?;
    if output.trim() != "ok" {
        return Ok(false);
    }
    Ok(fs::metadata(path)
        .map(|meta| meta.len() > 0)
        .unwrap_or(false))
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("failed to run osascript: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            IMAGE_EXTENSIONS.iter().any(|candidate| *candidate == ext)
        })
        .unwrap_or(false)
}

fn unique_temp_image_path(ext: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("tempoterm-clipboard-images");
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create image temp dir: {e}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system clock is before UNIX epoch: {e}"))?
        .as_nanos();
    for index in 0..100 {
        let path = dir.join(format!("image-{stamp}-{index}.{ext}"));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("failed to allocate a unique clipboard image path".to_string())
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(target_os = "macos")]
fn applescript_string(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::is_image_path;
    use std::path::Path;

    #[test]
    fn detects_image_paths_by_extension() {
        assert!(is_image_path(Path::new("/tmp/a.PNG")));
        assert!(is_image_path(Path::new("/tmp/a.jpeg")));
        assert!(!is_image_path(Path::new("/tmp/a.txt")));
    }
}
