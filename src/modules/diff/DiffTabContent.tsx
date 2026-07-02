import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gitFileAtRev, gitResolveRepo } from "@/modules/source-control/lib/gitBridge";
import { fsReadFile } from "@/modules/explorer/lib/fsBridge";
import { loadLanguageExtension } from "@/modules/editor/lib/language";
import { dirname, relativePath } from "@/modules/explorer/lib/paths";
import { editorSyntaxTheme } from "@/themes/editorTheme";
import { selectTerminalFontFamily, useFontStore } from "@/stores/fontStore";
import { useSettingsStore } from "@/stores/settingsStore";

interface DiffTabContentProps {
  /** Absolute path of the file being compared. */
  path: string;
  /** true = HEAD vs index (staged tab); false = index vs working tree. */
  staged: boolean;
}

interface DiffDocs {
  left: string;
  right: string;
}

/**
 * Read-only side-by-side comparison of one file's uncommitted changes.
 * Unstaged tab: index (left) vs working tree (right). Staged tab: HEAD (left)
 * vs index (right). MergeView computes the highlighting from the two full
 * documents; contents reload when the window regains focus so the tab stays
 * roughly current without a file watcher.
 */
export function DiffTabContent({ path, staged }: DiffTabContentProps) {
  const { t } = useTranslation("sourceControl");
  const containerRef = useRef<HTMLDivElement>(null);
  const fontFamily = useFontStore(selectTerminalFontFamily);
  const fontSize = useFontStore((s) => s.fontSize);
  const themeId = useSettingsStore((s) => s.themeId);
  const [docs, setDocs] = useState<DiffDocs | null>(null);
  const [error, setError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Re-read both sides when the window regains focus (e.g. after staging or
  // editing elsewhere); cheap enough that no file watcher is needed.
  useEffect(() => {
    const bump = () => setRefreshKey((k) => k + 1);
    window.addEventListener("focus", bump);
    return () => window.removeEventListener("focus", bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const repo = await gitResolveRepo(dirname(path));
        if (!repo) {
          throw new Error("not a git repository");
        }
        const rel = relativePath(path, repo);
        const [left, right] = await Promise.all(
          staged
            ? [gitFileAtRev(repo, "HEAD", rel), gitFileAtRev(repo, ":", rel)]
            : [gitFileAtRev(repo, ":", rel), fsReadFile(path).catch(() => "")],
        );
        if (!cancelled) {
          setError(false);
          // Keep the previous object when nothing changed so the MergeView
          // effect doesn't tear down and lose scroll position on refocus.
          setDocs((prev) =>
            prev && prev.left === left && prev.right === right ? prev : { left, right },
          );
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [path, staged, refreshKey]);

  useEffect(() => {
    const parent = containerRef.current;
    if (!docs || !parent) {
      return;
    }
    let view: MergeView | null = null;
    let cancelled = false;
    void loadLanguageExtension(path).then((language) => {
      if (cancelled) {
        return;
      }
      const extensions = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        editorSyntaxTheme(themeId),
        EditorView.theme({
          "&": { fontSize: `${fontSize}px` },
          ".cm-content, .cm-gutters, .cm-scroller": { fontFamily },
        }),
        ...language,
      ];
      view = new MergeView({
        a: { doc: docs.left, extensions },
        b: { doc: docs.right, extensions },
        parent,
        gutter: true,
      });
    });
    return () => {
      cancelled = true;
      view?.destroy();
    };
  }, [docs, path, themeId, fontSize, fontFamily]);

  const name = path.split(/[\\/]/).pop() ?? path;

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 truncate text-xs text-fg-muted">{name}</span>
        <span className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] font-medium uppercase text-fg-subtle">
          {staged ? t("diffStaged") : t("diffUnstaged")}
        </span>
      </div>
      {error ? (
        <p className="px-3 py-2 text-xs text-danger">{t("diffLoadError")}</p>
      ) : (
        <div ref={containerRef} className="diff-merge-view min-h-0 flex-1 overflow-auto" />
      )}
    </div>
  );
}
