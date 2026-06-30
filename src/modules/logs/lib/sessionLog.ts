import { invoke } from "@tauri-apps/api/core";

export function enforceLogRetention(retentionDays: number | null): Promise<void> {
  return invoke<void>("session_logs_enforce_retention", { retentionDays });
}
