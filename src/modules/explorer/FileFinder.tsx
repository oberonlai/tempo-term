import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { fsListFiles } from "./lib/fsBridge";
import { fuzzyRank } from "./lib/fuzzy";
import { relativePath } from "./lib/paths";
import { InfoDialog } from "@/components/InfoDialog";
import { Tooltip } from "@/components/Tooltip";
import { useTabsStore } from "@/stores/tabsStore";

interface FileFinderProps {
  root: string;
  onClose: () => void;
}

export function FileFinder({ root, onClose }: FileFinderProps) {
  const { t } = useTranslation("explorer");
  const { t: tCommon } = useTranslation("common");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [atCapacity, setAtCapacity] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeResultRef = useRef<HTMLButtonElement | null>(null);
  const openFromSidebar = useTabsStore((s) => s.openFromSidebar);

  useEffect(() => {
    inputRef.current?.focus();
    let cancelled = false;
    fsListFiles(root, 20000)
      .then((list) => {
        if (!cancelled) {
          setFiles(list);
        }
      })
      .catch(() => setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [root]);

  const results = useMemo(() => fuzzyRank(query, files).slice(0, 50), [query, files]);

  // The result set changes on every keystroke; keep the highlighted row
  // pinned to the top match instead of an index that now points elsewhere.
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  useEffect(() => {
    activeResultRef.current?.scrollIntoView({ block: "nearest" });
    // A query change can leave activeIndex at the same value (still 0) while
    // the list itself re-filters, e.g. after the user wheel-scrolled away
    // from the top — results must stay in the dependency list so that case
    // still re-scrolls back to the active row.
  }, [activeIndex, results]);

  function open(path: string) {
    const result = openFromSidebar({ kind: "editor", path });
    if (result.status === "at-capacity") {
      setAtCapacity(true);
      return;
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // While an IME candidate window is open, Enter (and often the arrow keys)
    // commit/navigate the candidate, not this list — let them through.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      open(results[activeIndex]);
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex justify-center bg-black/40 pt-16">
      <div
        className="h-fit w-[90%] max-w-lg overflow-hidden rounded-lg border border-border-strong bg-bg-elevated shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search size={15} className="text-fg-subtle" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t("findPlaceholder")}
            aria-label={t("findFiles")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-fg-subtle">
              {t("noResults")}
            </li>
          ) : (
            results.map((path, index) => {
              const relative = relativePath(path, root);
              const active = index === activeIndex;
              return (
                <li key={path}>
                  <Tooltip label={relative} className="w-full">
                    <button
                      ref={active ? activeResultRef : undefined}
                      type="button"
                      onClick={() => open(path)}
                      // mousemove, not mouseenter: keyboard-driven scrolling
                      // can slide a row under a stationary cursor, and a plain
                      // enter there would steal the selection from the keyboard.
                      onMouseMove={() => setActiveIndex(index)}
                      aria-selected={active}
                      className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                        active ? "bg-bg text-fg" : "text-fg-muted hover:bg-bg hover:text-fg"
                      }`}
                    >
                      {relative}
                    </button>
                  </Tooltip>
                </li>
              );
            })
          )}
        </ul>
      </div>
      <div className="absolute inset-0 -z-10" onClick={onClose} />

      {atCapacity && (
        <InfoDialog
          title={t("findFiles")}
          message={tCommon("paneCapacityAlert")}
          confirmLabel={tCommon("actions.confirm")}
          onConfirm={() => setAtCapacity(false)}
        />
      )}
    </div>
  );
}
