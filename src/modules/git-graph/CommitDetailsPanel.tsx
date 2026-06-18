import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { gitCommitDetails, gitCommitFileDiff } from "./lib/gitGraphBridge";
import { parseDiffLines } from "./lib/parseDiff";
import { DiffView } from "./DiffView";
import type { CommitDetails, CommitNode, DiffLine } from "./types";

export interface CommitDetailsLabels {
  author: string;
  date: string;
  changedFiles: string;
  noChanges: string;
  noDiff: string;
  noFileSelected: string;
  close: string;
  diffTab: string;
  aiTab: string;
  aiGenerate: string;
  aiExplaining: string;
  aiRegenerate: string;
  aiNeedKey: string;
  aiEmpty: string;
}

interface CommitDetailsPanelProps {
  repo: string;
  commit: CommitNode;
  onClose: () => void;
  labels: CommitDetailsLabels;
}

const STATUS_COLORS: Record<string, string> = {
  A: "text-success",
  M: "text-warning",
  D: "text-danger",
  R: "text-accent",
  C: "text-accent",
  T: "text-fg-muted",
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unexpected error";
}

export function CommitDetailsPanel({ repo, commit, onClose, labels }: CommitDetailsPanelProps) {
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load message + changed files when the commit changes; auto-open first file.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetails(null);
    setSelectedFile(null);
    setDiffLines([]);
    gitCommitDetails(repo, commit.hash)
      .then((d) => {
        if (cancelled) {
          return;
        }
        setDetails(d);
        setSelectedFile(d.files[0]?.path ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(getErrorMessage(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, commit.hash]);

  // Lazily load the selected file's diff.
  useEffect(() => {
    if (!selectedFile) {
      setDiffLines([]);
      return;
    }
    let cancelled = false;
    gitCommitFileDiff(repo, commit.hash, selectedFile)
      .then((diff) => {
        if (!cancelled) {
          setDiffLines(parseDiffLines(diff));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiffLines([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, commit.hash, selectedFile]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex items-center justify-between border-b border-border bg-bg-inset px-3 py-1.5">
        <span className="select-all font-mono text-xs font-semibold text-accent">
          {commit.hash}
        </span>
        <button
          type="button"
          onClick={onClose}
          title={labels.close}
          className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <div className="px-3 py-1.5 text-xs text-danger" role="alert">{error}</div>}

      <div className="max-h-[45%] shrink-0 overflow-auto px-3 py-2">
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px] text-fg-subtle">
          <span>
            {labels.author}: {commit.author}
          </span>
          <span>
            {labels.date}: {commit.date}
          </span>
        </div>
        {details && (
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-fg">
            {details.message}
          </pre>
        )}
        <div className="mt-2">
          <div className="mb-1 text-[11px] font-medium text-fg-subtle">
            {labels.changedFiles} ({details?.files.length ?? 0})
          </div>
          {details && details.files.length === 0 ? (
            <div className="text-[11px] text-fg-subtle">{labels.noChanges}</div>
          ) : (
            <ul className="space-y-0.5">
              {details?.files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(f.path)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-0.5 text-left font-mono text-[11px] ${
                      selectedFile === f.path
                        ? "bg-bg-elevated text-fg"
                        : "text-fg-muted hover:bg-bg-elevated/50"
                    }`}
                  >
                    <span
                      className={`w-3 shrink-0 font-semibold ${STATUS_COLORS[f.status] ?? "text-fg-muted"}`}
                    >
                      {f.status}
                    </span>
                    <span className="truncate">{f.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 border-t border-border">
        {selectedFile ? (
          <DiffView lines={diffLines} emptyLabel={labels.noDiff} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
            {labels.noFileSelected}
          </div>
        )}
      </div>
    </div>
  );
}
