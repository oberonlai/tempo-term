//! First-run setup wizard backend: detects the CLI tools a Vibe Coding user
//! needs (node, git, gh, claude, codex, antigravity) plus the platform package
//! managers, and installs the missing ones with live output streamed to the
//! wizard. The tool registry is data-driven so adding or tweaking a tool is a
//! one-line change; version comparison is a pure function for easy testing.

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::ipc::Channel;

/// A single tool the wizard knows how to detect and install. The install
/// commands are the raw shell strings run per platform; an empty string means
/// "no automated install, guide the user to the official page instead".
struct ToolSpec {
    /// Stable id shared with the frontend registry.
    id: &'static str,
    /// The binary to probe with `<bin> --version`.
    bin: &'static str,
    /// Minimum acceptable major.minor, or None when any version is fine.
    min_version: Option<&'static str>,
    /// Install command on macOS (run via `sh -c`).
    mac_install: &'static str,
    /// Install command on Windows (run via `cmd /C`).
    windows_install: &'static str,
}

/// The tool registry. Keep in sync with the frontend `setup/lib/registry.ts`.
const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        id: "node",
        bin: "node",
        min_version: Some("18"),
        mac_install: "brew install node",
        windows_install: "winget install -e --id OpenJS.NodeJS --accept-package-agreements --accept-source-agreements",
    },
    ToolSpec {
        id: "git",
        bin: "git",
        min_version: Some("2.30"),
        mac_install: "brew install git",
        windows_install: "winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements",
    },
    ToolSpec {
        id: "gh",
        bin: "gh",
        min_version: Some("2.0"),
        mac_install: "brew install gh",
        windows_install: "winget install -e --id GitHub.cli --accept-package-agreements --accept-source-agreements",
    },
    ToolSpec {
        id: "claude",
        bin: "claude",
        min_version: None,
        mac_install: "npm install -g @anthropic-ai/claude-code",
        windows_install: "npm install -g @anthropic-ai/claude-code",
    },
    ToolSpec {
        id: "codex",
        bin: "codex",
        min_version: None,
        mac_install: "npm install -g @openai/codex",
        windows_install: "npm install -g @openai/codex",
    },
    ToolSpec {
        // Official installer scripts from https://antigravity.google/cli.
        // macOS/Linux uses the bash installer; Windows uses the CMD installer.
        id: "antigravity",
        bin: "antigravity",
        min_version: None,
        mac_install: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
        windows_install: "curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd",
    },
];

/// Detection result for one tool, returned to the wizard.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub id: String,
    pub installed: bool,
    pub version: Option<String>,
    pub meets_min: bool,
    /// Whether this tool has an automated install command on the current OS.
    pub installable: bool,
}

/// The whole detection payload: per-tool status plus package-manager presence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub tools: Vec<ToolStatus>,
    /// Homebrew present (macOS package manager).
    pub brew: bool,
    /// winget present (Windows package manager).
    pub winget: bool,
}

/// Pull the first dotted numeric token out of a `--version` line, e.g.
/// "git version 2.50.1 (Apple Git-155)" -> "2.50.1", "v22.14.0" -> "22.14.0".
pub fn parse_version(output: &str) -> Option<String> {
    let bytes = output.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                i += 1;
            }
            // Trim a trailing dot so "1." never slips through.
            let token = output[start..i].trim_end_matches('.');
            if token.chars().any(|c| c.is_ascii_digit()) {
                return Some(token.to_string());
            }
        } else {
            i += 1;
        }
    }
    None
}

/// Compare a detected version against a minimum, component by component. A
/// missing component counts as 0 (so "2" satisfies min "2.0"). Non-numeric
/// input fails closed (returns false).
pub fn meets_min(version: &str, min: &str) -> bool {
    let parse = |s: &str| -> Option<Vec<u64>> {
        s.split('.').map(|p| p.parse::<u64>().ok()).collect()
    };
    let (Some(have), Some(need)) = (parse(version), parse(min)) else {
        return false;
    };
    let len = have.len().max(need.len());
    for idx in 0..len {
        let h = have.get(idx).copied().unwrap_or(0);
        let n = need.get(idx).copied().unwrap_or(0);
        if h != n {
            return h > n;
        }
    }
    true
}

/// Run `<bin> --version` and return its combined output, or None if the binary
/// is absent or errors out.
fn probe_version(bin: &str) -> Option<String> {
    let output = Command::new(bin)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() && output.stdout.is_empty() {
        return None;
    }
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&output.stderr).into_owned();
    }
    parse_version(&text)
}

/// Whether a command is resolvable on PATH.
fn command_exists(bin: &str) -> bool {
    let (finder, arg) = if cfg!(target_os = "windows") {
        ("where", bin)
    } else {
        ("command", bin)
    };
    // `command -v` is a shell builtin, so route it through the shell on unix.
    if cfg!(target_os = "windows") {
        Command::new(finder)
            .arg(arg)
            .stdin(Stdio::null())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(format!("command -v {bin}"))
            .stdin(Stdio::null())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}

/// The install command string for `spec` on the current OS ("" when none).
fn install_command(spec: &ToolSpec) -> &'static str {
    if cfg!(target_os = "windows") {
        spec.windows_install
    } else {
        spec.mac_install
    }
}

/// Detect all tools and the package managers. Runs the blocking probes on a
/// worker thread so the GUI thread never stalls (same reasoning as sysmon).
#[tauri::command]
pub async fn detect_tools() -> Result<DetectResult, String> {
    tauri::async_runtime::spawn_blocking(detect_tools_blocking)
        .await
        .map_err(|e| e.to_string())
}

fn detect_tools_blocking() -> DetectResult {
    let tools = TOOLS
        .iter()
        .map(|spec| {
            let version = probe_version(spec.bin);
            let installed = version.is_some();
            let meets_min = match (&version, spec.min_version) {
                (Some(v), Some(min)) => meets_min(v, min),
                (Some(_), None) => true,
                (None, _) => false,
            };
            ToolStatus {
                id: spec.id.to_string(),
                installed,
                version,
                meets_min,
                installable: !install_command(spec).is_empty(),
            }
        })
        .collect();

    DetectResult {
        tools,
        brew: command_exists("brew"),
        winget: command_exists("winget"),
    }
}

/// Install one tool by id, streaming combined stdout/stderr to `on_output`
/// line by line. Returns the process exit code (0 = success). stderr is merged
/// into stdout via the shell so a single reader captures everything in order.
#[tauri::command]
pub async fn install_tool(id: String, on_output: Channel<String>) -> Result<i32, String> {
    let spec = TOOLS
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("unknown tool: {id}"))?;
    let cmd = install_command(spec);
    if cmd.is_empty() {
        return Err(format!("no automated install for {id}"));
    }
    let cmd = cmd.to_string();
    tauri::async_runtime::spawn_blocking(move || run_install(&cmd, &on_output))
        .await
        .map_err(|e| e.to_string())?
}

fn run_install(cmd: &str, on_output: &Channel<String>) -> Result<i32, String> {
    let mut child = if cfg!(target_os = "windows") {
        Command::new("cmd")
            .arg("/C")
            .arg(format!("{cmd} 2>&1"))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(format!("{cmd} 2>&1"))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
    }
    .map_err(|e| format!("failed to start install: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let _ = on_output.send(text);
                }
                Err(_) => break,
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    Ok(status.code().unwrap_or(-1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_version_formats() {
        assert_eq!(parse_version("v22.14.0").as_deref(), Some("22.14.0"));
        assert_eq!(
            parse_version("git version 2.50.1 (Apple Git-155)").as_deref(),
            Some("2.50.1")
        );
        assert_eq!(
            parse_version("gh version 2.86.0 (2026-01-21)").as_deref(),
            Some("2.86.0")
        );
        assert_eq!(parse_version("2.1.195 (Claude Code)").as_deref(), Some("2.1.195"));
        assert_eq!(parse_version("codex-cli 0.137.0").as_deref(), Some("0.137.0"));
        assert_eq!(parse_version("no numbers here"), None);
    }

    #[test]
    fn version_comparison() {
        assert!(meets_min("22.14.0", "18"));
        assert!(meets_min("18.0.0", "18"));
        assert!(!meets_min("16.20.0", "18"));
        assert!(meets_min("2.50.1", "2.30"));
        assert!(!meets_min("2.29.0", "2.30"));
        assert!(meets_min("2", "2.0"));
        assert!(meets_min("2.0", "2"));
        assert!(!meets_min("garbage", "2.0"));
    }
}
