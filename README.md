<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="TempoTerm" />

# TempoTerm

An AI-native terminal workspace that brings the terminal, code editor, file explorer, Git and an AI assistant into a single window, with first-class Traditional Chinese support.

**English** · [正體中文](./README.zh-Hant.md) · [简体中文](./README.zh-Hans.md)

</div>

TempoTerm is a desktop app built on Tauri 2 + Rust and React 19. It pairs a native PTY terminal with a code editor, file explorer, source control, web preview, notes and a bring-your-own-key AI assistant, and ships a full Traditional Chinese interface with CJK-friendly terminal fonts. It organizes your work into named workspaces, and each workspace card tracks its Claude Code session status live, alongside the Git branch, worktree and matching pull request.

<div align="center">

<img src="screenshots/hero.png" alt="TempoTerm workspace: terminal, editor, file explorer and AI assistant in one window" width="860" />

</div>

## Features

### Workspaces & Claude sessions

- Organize work into named workspaces in a sidebar, with rename and delete from the list; the app opens on this panel
- Each workspace card shows the Git branch and worktree, a live Claude Code session status badge (working, thinking, waiting for input, waiting for approval) you can filter by, and the matching pull request status
- Card titles are derived automatically from the Claude session transcript
- Session status comes from a Claude Code hook you can toggle; choose which blocks a card shows and where PR data comes from in settings

![Workspace sidebar with live Claude session cards](screenshots/workspaces.png)

### Terminal

- xterm.js v6 over a native PTY (portable-pty), with typed tabs
- GPU-accelerated rendering via WebGL (with a DOM-renderer fallback) keeps scrolling and heavy output smooth
- Free split layout: panels can mix types, for example a terminal next to a file editor, with draggable dividers to resize
- Drag to reorder tabs, with a per-workspace tab count badge in the tab bar
- Cmd or Ctrl click a file path in the output to open it in a split pane, with a hover hint and support for paths broken across wrapped lines
- Optionally restore each terminal's previous output as read-only scrollback on the next launch
- Standard editing shortcuts that carry over from other terminals: Shift+Enter, word and line navigation, delete to line start/end, copy and paste
- Unicode 11 width tables so full-width CJK glyphs stay aligned

### Editor

- CodeMirror 6 with syntax highlighting
- Follows the app theme's light or dark appearance
- Markdown files toggle between edit, split and preview

### File explorer

- File tree with fuzzy find and content grep
- Two-way directory sync with the terminal: cd on either side moves the other
- Right-click context menu: open, reveal in Finder, new file or folder, copy path, attach to the AI agent, delete to trash
- Drag a file or folder onto any pane, with behavior per pane type

![Fuzzy file finder](screenshots/fuzzy-find.png)

### Source control

- Stage, unstage, commit and push, with changes grouped by folder and folder-level staging
- Generate a Conventional Commits message from the staged diff with AI
- Commit graph (DAG) with branch and tag actions; click any commit to see its changed files and diff
- Ask AI to explain a commit's diff in plain, scannable language
- Toolbar for remote branches, stashes, fetch and keyword search

![Git commit graph](screenshots/git-graph.png)

### Web preview

- Embedded preview of a URL or a dropped local file

### Notes

- WYSIWYG editor (TipTap) with a slash command menu
- Code blocks with syntax highlighting, copy and run-in-terminal
- Global folders that persist across restarts

### AI assistant

- Bring your own key: OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Ollama and any OpenAI-compatible endpoint
- Keys are stored in the OS keychain and never returned to the webview
- Replies render as Markdown; attach files from the explorer as context

![AI assistant panel with a Markdown reply](screenshots/ai-assistant.png)

### Themes and languages

- Several dark and light themes, applied across the whole window
- Full English and Traditional Chinese UI, switchable on the fly
- CJK-friendly terminal font settings

![Theme and language settings](screenshots/themes.png)

## Tech stack

Tauri 2, Rust, portable-pty, git2, keyring, React 19, TypeScript, Vite, Zustand, Tailwind CSS v4, xterm.js v6, CodeMirror 6, TipTap, i18next.

## Development

```bash
pnpm install        # install frontend dependencies
pnpm tauri dev      # run the desktop app in dev mode
pnpm typecheck      # TypeScript type check
pnpm build          # build the frontend
```

## Testing

```bash
pnpm test                       # frontend unit and integration tests (Vitest)
cd src-tauri && cargo test      # backend Rust tests
```
