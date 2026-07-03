import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useNotifyStore } from "@/stores/notifyStore";

const ENTER_MS = 500;
const STAY_MS = 3000;
const EXIT_MS = 500;

/**
 * Transient top-center notice for app-wide feedback (e.g. "檔案總管已更新"
 * after a worktree switch). Post via useNotifyStore.getState().notify(text).
 * Fades in (0.5s), stays (3s), fades out (0.5s); the X closes it early with
 * the same fade. Colors invert the app theme (bg-fg / text-bg) so the toast
 * stands out against whatever the theme background is.
 */
export function NotifyToast() {
  const { t } = useTranslation();
  const notice = useNotifyStore((s) => s.notice);
  const clear = useNotifyStore((s) => s.clear);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (!notice) {
      setFaded(false);
      return;
    }
    setFaded(false);
    // Flip on the next tick so the browser paints the opacity-0 frame first
    // and the 0.5s opacity transition actually runs.
    const enter = setTimeout(() => setFaded(true), 20);
    const exit = setTimeout(() => setFaded(false), ENTER_MS + STAY_MS);
    const remove = setTimeout(clear, ENTER_MS + STAY_MS + EXIT_MS);
    return () => {
      clearTimeout(enter);
      clearTimeout(exit);
      clearTimeout(remove);
    };
  }, [notice, clear]);

  if (!notice) {
    return null;
  }

  function dismiss() {
    const dismissed = notice;
    setFaded(false);
    setTimeout(() => {
      // A newer notice may have replaced this one during the fade — only
      // clear if the store still holds the notice the user dismissed.
      if (useNotifyStore.getState().notice === dismissed) {
        clear();
      }
    }, EXIT_MS);
  }

  return (
    <div
      role="status"
      className={`fixed left-1/2 top-12 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-lg bg-fg py-2.5 pl-4 pr-2.5 text-xs font-medium text-bg shadow-2xl transition-opacity duration-500 ${
        faded ? "opacity-100" : "opacity-0"
      }`}
    >
      {notice.text}
      <button
        type="button"
        aria-label={t("actions.close")}
        onClick={dismiss}
        className="rounded p-0.5 text-bg/70 hover:bg-bg/10 hover:text-bg"
      >
        <X size={13} />
      </button>
    </div>
  );
}
