## 正體中文

### feat
- tab 列的新增分頁按鈕改放在最後一個分頁旁邊，不再擠在最右邊看不清楚；側邊欄每個 workspace 也加了新增分頁按鈕，會在該 workspace 開新分頁，同一排的編輯與刪除按鈕也改為固定顯示
- 側邊欄改版：頂部面板切換列改用底線標示目前面板、不再用整塊底色，每張 tab 卡片左側顯示序號，方便用 ⌘ 數字快速切換，並移除 workspace 標題列的數量數字

### fix
- zsh 指令自動建議在剛開的終端機就會出現，輸入過的指令也會寫回共用的歷史檔，和系統其他終端機互通；先前包裝載入外掛的機制讓 macOS 把歷史檔指到 app 內部的空目錄，導致第一次使用沒有建議、紀錄也不共用

## English

### feat
- The new-tab button now sits next to the latest tab instead of the far right edge; each workspace in the sidebar also gets a new-tab button that opens a tab in that workspace, and the rename and delete actions on that row are now always visible
- Sidebar refresh: the top panel switcher marks the current panel with an underline instead of a filled background, each tab card shows a number on its left for quick ⌘-number switching, and the count number on the workspace header is removed

### fix
- zsh command autosuggestions now show up right away in a freshly opened terminal, and the commands you run are written back to the shared history file so they stay in sync with your other terminals; the plugin wrapper had let macOS point the history file at an empty in-app directory, so first use showed no suggestions and history was not shared
