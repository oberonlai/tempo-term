import { useEffect } from "react";
import { useNotifyStore } from "@/stores/notifyStore";

const FADE_MS = 4000;

/**
 * Transient top-center notice for app-wide feedback (e.g. "檔案總管已更新"
 * after a worktree switch). Post via useNotifyStore.getState().notify(text).
 * Auto-fades and never blocks input. Colors invert the app theme (bg-fg /
 * text-bg) so the toast stands out against whatever the theme background is.
 */
export function NotifyToast() {
  const notice = useNotifyStore((s) => s.notice);
  const clear = useNotifyStore((s) => s.clear);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(clear, FADE_MS);
    return () => clearTimeout(timer);
  }, [notice, clear]);

  if (!notice) {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed left-1/2 top-12 z-[90] -translate-x-1/2 rounded-lg bg-fg px-4 py-2.5 text-xs font-medium text-bg shadow-2xl"
    >
      {notice.text}
    </div>
  );
}
