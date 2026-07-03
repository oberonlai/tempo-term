## 正體中文

### feat

- Windows：檔案總管、Git 頁籤與 AI 專案脈絡現在會跟著終端機的 `cd` 移動——PowerShell 與 cmd.exe 透過注入的 shell integration 在每次提示符以 OSC 7 回報工作目錄，行為與 macOS/Linux 一致 (#101)
- 原始碼控制側邊欄：點擊變更檔案會開啟並排差異分頁，單一檔案可棄置變更，並提供應用程式自己的右鍵選單；依資料夾分組改為真正的巢狀樹狀結構，資料夾的暫存與取消暫存會作用到整個子樹，資料夾可折疊
- 差異檢視強化：行號、自動換行切換、上一個與下一個變更的跳轉、收合未變更區塊、變更區塊計數
- 側邊欄的近期提交可點擊，會跳到 Git Graph 分頁並選中該筆提交；Git Graph 的提交列整列都可點擊展開詳情
- Git Graph 提交詳情的變更檔案清單新增平面與樹狀檢視切換
- Git Graph 工具列新增 worktree 選擇器，可直接把整個視窗切到另一個 worktree，檔案總管與側邊欄會跟著切換並跳出通知；工具列的 HEAD 顯示變成分支切換選單，本地分支點了直接 checkout，遠端分支會引導建立追蹤分支，被其他 worktree 佔用的分支會停用並標示所在位置
- 新增頂部置中的通知提示：淡入後停留三秒自動淡出，也可按 X 提早關閉
- App 內所有提示框（tooltip）統一改用同一套樣式：原生 title 全數換成共用元件，滑鼠停留約 0.3 秒才出現、按下即消失，預設顯示在元素上方避免被游標遮住；終端機連結與筆記連結的提示樣式也一併對齊
- 檔案總管新增「全部收合」按鈕，一鍵收起所有展開的資料夾，SSH 遠端瀏覽模式也適用
- 分頁有未儲存變更時，關閉鈕（✕）滑鼠停留會顯示「未儲存」提示

### fix

### 感謝

- 感謝 @j7-dev 貢獻 Windows 終端機工作目錄跟隨功能（#115）

## English

### feat

- Windows: the file explorer, Git tab and AI project context now follow the terminal's `cd` — PowerShell and cmd.exe report their working directory via OSC 7 shell integration on every prompt, matching macOS/Linux behaviour (#101)
- Source-control sidebar: clicking a changed file opens a side-by-side diff tab, individual files can be discarded, and the panel now has its own context menus; the group-by-folder view is a true nested tree where a folder's stage/unstage acts on its whole subtree and folders collapse
- Diff view upgrades: line numbers, a wrap toggle, previous/next change navigation, collapsing unchanged regions, and a change-block counter
- Recent commits in the sidebar are clickable and jump to the Git Graph tab with that commit selected; Git Graph commit rows expand from a click anywhere on the row
- The Git Graph commit-details file list gains a flat/tree view toggle
- The Git Graph toolbar gains a worktree selector that switches the whole window to another worktree, with the file explorer and sidebar following along and a confirmation notice; the HEAD display becomes a branch-switch menu where local branches check out directly, remote branches guide you through creating a tracking branch, and branches held by another worktree are disabled with their location shown
- New top-center notification toast: fades in, stays three seconds, fades out, and can be closed early with the X
- Unified tooltips across the app: every native `title` hint now renders through one shared component that appears after a ~0.3s hover, hides on click, and opens above the element so the cursor never covers it; terminal-link and note-link hints match the same style
- Added a "Collapse All" button to the file explorer that folds every expanded folder at once, including in remote (SFTP) browsing
- The tab close button (✕) now shows an "Unsaved changes" hint on hover when the tab has unsaved edits

### fix

### Thanks

- Thanks to @j7-dev for contributing the Windows terminal cwd-following feature (#115)
