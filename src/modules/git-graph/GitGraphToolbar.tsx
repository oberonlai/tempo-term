import { useState } from "react";
import {
  Check,
  DownloadCloud,
  RefreshCw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import type { Branch } from "./types";

export interface GitGraphToolbarLabels {
  branches: string;
  showAll: string;
  showRemoteBranches: string;
  localGroup: string;
  remoteGroup: string;
  search: string;
  searchPlaceholder: string;
  displayOptions: string;
  showTags: string;
  showStashes: string;
  refresh: string;
  fetch: string;
  fetching: string;
  matches: string;
  head: string;
}

interface GitGraphToolbarProps {
  branches: Branch[];
  selectedBranch: string | null;
  onSelectBranch: (branch: string | null) => void;
  includeRemotes: boolean;
  onToggleRemotes: (value: boolean) => void;
  includeTags: boolean;
  onToggleTags: (value: boolean) => void;
  includeStashes: boolean;
  onToggleStashes: (value: boolean) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  matchCount: number;
  onRefresh: () => void;
  onFetch: () => void;
  fetching: boolean;
  currentBranch: string;
  labels: GitGraphToolbarLabels;
}

const SHOW_ALL = "__all__";

export function GitGraphToolbar({
  branches,
  selectedBranch,
  onSelectBranch,
  includeRemotes,
  onToggleRemotes,
  includeTags,
  onToggleTags,
  includeStashes,
  onToggleStashes,
  searchQuery,
  onSearchChange,
  matchCount,
  onRefresh,
  onFetch,
  fetching,
  currentBranch,
  labels,
}: GitGraphToolbarProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const locals = branches.filter((b) => !b.isRemote);
  const remotes = branches.filter((b) => b.isRemote);

  return (
    <div className="relative flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-inset px-3 py-2">
      {/* 左側：分支下拉 + 遠端開關 */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <span>{labels.branches}:</span>
          <select
            value={selectedBranch ?? SHOW_ALL}
            onChange={(e) =>
              onSelectBranch(e.target.value === SHOW_ALL ? null : e.target.value)
            }
            className="rounded border border-border-strong bg-bg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value={SHOW_ALL}>{labels.showAll}</option>
            <optgroup label={labels.localGroup}>
              {locals.map((b) => (
                <option key={`local:${b.name}`} value={b.name}>
                  {b.name}
                </option>
              ))}
            </optgroup>
            {includeRemotes && remotes.length > 0 && (
              <optgroup label={labels.remoteGroup}>
                {remotes.map((b) => (
                  <option key={`remote:${b.name}`} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={includeRemotes}
            onChange={(e) => onToggleRemotes(e.target.checked)}
            className="accent-accent"
          />
          <span>{labels.showRemoteBranches}</span>
        </label>
      </div>

      {/* 右側：搜尋 + 顯示選項 + Refresh + Fetch + HEAD */}
      <div className="flex items-center gap-2">
        {searchOpen ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={labels.searchPlaceholder}
              className="w-52 rounded border border-border-strong bg-bg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {searchQuery.trim() !== "" && (
              <span className="whitespace-nowrap font-mono text-[11px] text-fg-subtle">
                {labels.matches.replace("{{count}}", String(matchCount))}
              </span>
            )}
            <button
              type="button"
              title={labels.search}
              onClick={() => {
                onSearchChange("");
                setSearchOpen(false);
              }}
              className="rounded p-1 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            title={labels.search}
            onClick={() => setSearchOpen(true)}
            className="rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          >
            <Search className="h-4 w-4" />
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            title={labels.displayOptions}
            onClick={() => setOptionsOpen((v) => !v)}
            className="rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          {optionsOpen && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setOptionsOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 z-30 mt-1 w-44 rounded-md border border-border-strong bg-bg-elevated p-1 shadow-lg">
                <ToggleRow
                  label={labels.showTags}
                  checked={includeTags}
                  onChange={onToggleTags}
                />
                <ToggleRow
                  label={labels.showStashes}
                  checked={includeStashes}
                  onChange={onToggleStashes}
                />
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          title={labels.refresh}
          onClick={onRefresh}
          className="rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg"
        >
          <RefreshCw className="h-4 w-4" />
        </button>

        <button
          type="button"
          title={fetching ? labels.fetching : labels.fetch}
          onClick={onFetch}
          disabled={fetching}
          className="rounded p-1.5 text-fg-subtle hover:bg-bg-elevated hover:text-fg disabled:opacity-50"
        >
          <DownloadCloud className={`h-4 w-4 ${fetching ? "animate-pulse" : ""}`} />
        </button>

        <span className="ml-1 font-mono text-[11px] text-fg-subtle">
          {labels.head}: {currentBranch}
        </span>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-inset hover:text-fg"
    >
      <span>{label}</span>
      {checked && <Check className="h-3.5 w-3.5 text-accent" />}
    </button>
  );
}
