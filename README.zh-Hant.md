<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="TempoTerm" />

# TempoTerm

一個 AI 原生的終端機工作區，把終端機、程式碼編輯器、檔案總管、Git 與 AI 助手整合在同一個視窗，並提供完整的正體中文支援

[English](./README.md) · **正體中文** · [简体中文](./README.zh-Hans.md)

</div>

TempoTerm 是一個用 Tauri 2 加 Rust 與 React 19 打造的桌面 app，把原生 PTY 終端機、程式碼編輯器、檔案總管、版本控制、網頁預覽、筆記與自帶金鑰的 AI 助手放在一起，並提供完整的正體中文介面與對正體中文友善的終端機字體；也把工作整理成具名的工作區，每張工作區卡片即時追蹤對應 Claude 工作階段的狀態，以及 Git 分支、worktree 與對應的 PR

<div align="center">

<img src="screenshots/hero.png" alt="TempoTerm 把終端機、編輯器、檔案總管與 AI 助手放在同一個視窗" width="860" />

</div>

## 功能

### 工作區與 Claude 工作階段

- 在側邊欄用具名工作區整理工作，可從清單重新命名與刪除，app 一開就停在這個面板
- 每張工作區卡片顯示 Git 分支與 worktree、即時的 Claude 工作階段狀態徽章（執行中、思考中、等待輸入、等待批准，可依狀態篩選），以及對應的 PR 狀態
- 卡片標題會自動從 Claude 工作階段的對話記錄推導出來
- 工作階段狀態來自一支可開關的 Claude Code hook；可在設定裡選卡片顯示哪些區塊，以及 PR 資料的來源

![工作區側邊欄與即時 Claude 工作階段卡片](screenshots/workspaces.png)

### 終端機

- 以原生 PTY（portable-pty）驅動的 xterm.js v6，分頁可以指定類型
- 以 WebGL 做 GPU 加速渲染（不可用時自動退回 DOM 渲染），捲動與大量輸出更順
- 自由分割版面，同一組分割能混合不同類型，例如終端機與檔案編輯器並排，分割線可以拖曳調整比例
- 分頁可以拖曳重新排序，分頁列會以徽章顯示每個工作區的分頁數
- 在輸出裡 Cmd 或 Ctrl 點擊檔案路徑，就會在旁邊的分割面板開啟，附 hover 提示，連被換行折斷的路徑也認得出來
- 可選擇在下次啟動時，把每個終端機的上次輸出以唯讀方式還原
- 對齊其他終端機的標準編輯快捷，方便轉移過來：Shift+Enter、依單字與行移動、刪到行首或行尾、複製貼上
- 採用 Unicode 11 字寬表，全形中文字維持對齊

### 編輯器

- CodeMirror 6 加語法高亮
- 跟著 app 主題切換明暗
- Markdown 檔案可在編輯、並排、預覽之間切換

### 檔案總管

- 檔案樹，支援模糊搜尋與內容 grep
- 與終端機目錄雙向同步：任一邊 cd，另一邊跟著切
- 右鍵選單：開啟、在 Finder 顯示、新增檔案或資料夾、複製路徑、附加給 AI 助手、刪除到垃圾桶
- 把檔案或資料夾拖到任一面板，依面板類型有對應行為

![模糊搜尋檔案](screenshots/fuzzy-find.png)

### 版本控制

- 暫存、取消暫存、提交與推送，變更依資料夾分組，可整個資料夾一次 stage
- 用 AI 從 staged diff 產生 Conventional Commits 訊息
- 提交圖（DAG）與分支、tag 操作；點任一 commit 看變更檔案與 diff
- 讓 AI 用白話、好掃讀的方式解釋這個 commit 的 diff
- 工具列支援遠端分支、stash、fetch 與關鍵字搜尋

![Git 提交圖](screenshots/git-graph.png)

### 網頁預覽

- 內嵌預覽一個網址，或拖進來的本機檔案

### 筆記

- 所見即所得編輯器（TipTap），內建斜線指令選單
- 程式碼區塊支援語法高亮、複製與在終端機執行
- 全域資料夾，重啟後依然保留

### AI 助手

- 自帶金鑰：OpenAI、Anthropic、Google Gemini、Groq、DeepSeek、Ollama，以及任何相容 OpenAI 的端點
- 金鑰存在系統 keychain，不會回傳到 app 視窗
- 回覆以 Markdown 呈現，可從檔案總管把檔案附加為情境

![AI 助手面板與 Markdown 回覆](screenshots/ai-assistant.png)

### 主題與語系

- 多套深色與淺色主題，套用到整個視窗
- 正體中文與英文雙語介面，可即時切換
- 對正體中文友善的終端機字體設定

![主題與語系設定](screenshots/themes.png)

## 技術堆疊

Tauri 2、Rust、portable-pty、git2、keyring、React 19、TypeScript、Vite、Zustand、Tailwind CSS v4、xterm.js v6、CodeMirror 6、TipTap、i18next

## 開發

```bash
pnpm install        # 安裝前端依賴
pnpm tauri dev      # 以開發模式啟動桌面 app
pnpm typecheck      # TypeScript 型別檢查
pnpm build          # 建置前端
```

## 測試

```bash
pnpm test                       # 前端單元與整合測試（Vitest）
cd src-tauri && cargo test      # 後端 Rust 測試
```
