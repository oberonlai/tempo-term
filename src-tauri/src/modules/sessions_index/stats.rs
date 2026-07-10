//! Aggregated stats for the sessions dashboard: summary cards, an activity
//! heatmap, top sessions by message/token volume, and a per-agent weekly
//! breakdown. Everything is computed with SQL against the metadata index —
//! message bodies are never touched, so this stays cheap even over years of
//! history.

use chrono::{Duration, Local};
use rusqlite::{params, params_from_iter, Connection, Row, ToSql};

use super::index::Index;
use super::types::SessionSummary;

/// Everything the dashboard renders in one round trip.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionsStats {
    pub cards: StatsCards,
    /// One entry per date with activity, ascending.
    pub heatmap: Vec<HeatmapDay>,
    /// Up to 10, ordered by message count descending.
    pub top_by_messages: Vec<TopSession>,
    /// Up to 10, sessions with tokens only, ordered by tokens descending.
    pub top_by_tokens: Vec<TopSession>,
    /// Last 7 local days, one row per agent seen in that window.
    pub weekly: Vec<WeeklyAgentRow>,
    /// Per-model output tokens over the selected range, for a rough total
    /// cost estimate on the cards. NULL-model tokens are excluded here but
    /// still counted in `cards.output_tokens`.
    pub range_models: Vec<ModelTokens>,
    /// Messages per hour-of-day (local) for TODAY, always length 24
    /// (index 0 = 00:00), for the "today by hour" chart and peak-hour readout.
    pub hourly: Vec<i64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StatsCards {
    pub sessions: i64,
    pub messages: i64,
    pub user_messages: i64,
    /// Distinct non-empty `project_cwd`.
    pub projects: i64,
    /// Distinct activity dates.
    pub active_days: i64,
    /// `0.0` when `sessions == 0`.
    pub messages_per_session: f64,
    /// Total assistant output tokens in range (0 when none are recorded).
    pub output_tokens: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HeatmapDay {
    pub date: String,
    pub messages: i64,
    /// Distinct sessions active on this date.
    pub sessions: i64,
    /// Total assistant output tokens on this date.
    pub output_tokens: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TopSession {
    pub id: String,
    pub agent: String,
    pub title: String,
    pub project_cwd: String,
    pub value: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WeeklyAgentRow {
    pub agent: String,
    pub sessions: i64,
    pub messages: i64,
    pub output_tokens: i64,
    pub models: Vec<ModelTokens>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ModelTokens {
    pub model: String,
    pub output_tokens: i64,
}

/// Per-project aggregates + this project's recent sessions, for the project
/// view. Filtered to `project_cwd = ?1`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectStats {
    pub project_cwd: String,
    pub sessions: i64,
    pub messages: i64,
    pub output_tokens: i64,
    pub active_days: i64,
    /// Model used in the most sessions in this project (ties by model name),
    /// or None when no session here recorded a model.
    pub top_model: Option<String>,
    pub first_at: i64,
    pub last_at: i64,
    /// This project's sessions, newest first (capped at 50).
    pub recent: Vec<SessionSummary>,
}

/// Zeroed stats for an empty (or not-yet-started) index. Never `Err`.
pub(crate) fn empty_stats() -> SessionsStats {
    SessionsStats {
        cards: StatsCards {
            sessions: 0,
            messages: 0,
            user_messages: 0,
            projects: 0,
            active_days: 0,
            messages_per_session: 0.0,
            output_tokens: 0,
        },
        heatmap: Vec::new(),
        top_by_messages: Vec::new(),
        top_by_tokens: Vec::new(),
        weekly: Vec::new(),
        range_models: Vec::new(),
        hourly: vec![0; 24],
    }
}

/// Local-date cutoff string ("YYYY-MM-DD") for `days` days back, or `""`
/// (all-time) when `days` is `None`. `""` sorts before every real date
/// string, so `date >= cutoff` is unconditionally true in that case —
/// letting all-time and ranged queries share one parameterized clause.
fn range_cutoff(days: Option<i64>) -> String {
    match days {
        Some(d) => (Local::now().date_naive() - Duration::days(d)).format("%Y-%m-%d").to_string(),
        None => String::new(),
    }
}

fn row_to_top_session(r: &Row) -> rusqlite::Result<TopSession> {
    Ok(TopSession {
        id: r.get(0)?,
        agent: r.get(1)?,
        title: r.get(2)?,
        project_cwd: r.get(3)?,
        value: r.get(4)?,
    })
}

/// Runs a top-sessions query with a dynamically-built bind list (anonymous `?`
/// placeholders, bound in order). The bind list varies with the range/project
/// filters, so a single runner replaces the fixed-arity helpers.
fn query_top_sessions(conn: &Connection, sql: &str, binds: &[&dyn ToSql]) -> Vec<TopSession> {
    let Ok(mut stmt) = conn.prepare(sql) else { return Vec::new() };
    let Ok(rows) = stmt.query_map(params_from_iter(binds.iter().copied()), row_to_top_session)
    else {
        return Vec::new();
    };
    rows.flatten().collect()
}

/// The `AND ...` fragment (using an anonymous `?` placeholder) that scopes an
/// `activity` query to one project's sessions, or `""` when unscoped. The
/// activity table has no `project_cwd`, so it filters through the `sessions`
/// table by session id. Callers push the same `project` value onto their bind
/// list only when this returns a non-empty string.
fn activity_project_clause(project: Option<&str>) -> &'static str {
    match project {
        Some(_) => " AND session_id IN (SELECT id FROM sessions WHERE project_cwd = ?)",
        None => "",
    }
}

impl Index {
    /// All aggregates for sessions whose activity falls in the last `days`
    /// local days (`None` = all time). Defensive: an empty index, or any
    /// query failure (e.g. tables not yet created), yields zeroed stats —
    /// the dashboard always has something to render.
    pub fn stats(&self, days: Option<i64>, project: Option<&str>) -> SessionsStats {
        let cutoff = range_cutoff(days);
        SessionsStats {
            cards: self.stats_cards(&cutoff, project),
            heatmap: self.stats_heatmap(&cutoff, project),
            top_by_messages: self.stats_top_by_messages(days, &cutoff, project),
            top_by_tokens: self.stats_top_by_tokens(days, &cutoff, project),
            weekly: self.stats_weekly(project),
            range_models: self.stats_range_models(&cutoff, project),
            hourly: self.stats_hourly_today(project),
        }
    }

    /// Messages per hour-of-day (0..23) for TODAY (local), always length 24 —
    /// a "what have I done today" view, independent of the range filter.
    fn stats_hourly_today(&self, project: Option<&str>) -> Vec<i64> {
        let mut hourly = vec![0i64; 24];
        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let sql = format!(
            "SELECT hour, COALESCE(SUM(messages),0) FROM activity
             WHERE date = ?{} GROUP BY hour",
            activity_project_clause(project),
        );
        let mut binds: Vec<&dyn ToSql> = vec![&today];
        if let Some(ref p) = project {
            binds.push(p);
        }
        let Ok(mut stmt) = self.conn.prepare(&sql) else {
            return hourly;
        };
        let Ok(rows) = stmt.query_map(params_from_iter(binds.iter().copied()), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
        }) else {
            return hourly;
        };
        for (hour, messages) in rows.flatten() {
            if (0..24).contains(&hour) {
                hourly[hour as usize] = messages;
            }
        }
        hourly
    }

    fn stats_cards(&self, cutoff: &str, project: Option<&str>) -> StatsCards {
        let totals_sql = format!(
            "SELECT COUNT(DISTINCT session_id), COALESCE(SUM(messages),0),
                    COALESCE(SUM(user_messages),0), COUNT(DISTINCT date),
                    COALESCE(SUM(output_tokens),0)
             FROM activity WHERE date >= ?{}",
            activity_project_clause(project),
        );
        let mut totals_binds: Vec<&dyn ToSql> = vec![&cutoff];
        if let Some(ref p) = project {
            totals_binds.push(p);
        }
        let totals: Option<(i64, i64, i64, i64, i64)> = self
            .conn
            .query_row(&totals_sql, params_from_iter(totals_binds.iter().copied()), |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .ok();
        let (sessions, messages, user_messages, active_days, output_tokens) =
            totals.unwrap_or((0, 0, 0, 0, 0));

        // Scoped to a project, the distinct-project count is trivially 0 or 1;
        // the same query yields that, so no special-casing is needed.
        let projects_sql = format!(
            "SELECT COUNT(DISTINCT s.project_cwd) FROM sessions s
             WHERE s.project_cwd != ''
               AND s.id IN (SELECT DISTINCT session_id FROM activity WHERE date >= ?){}",
            match project {
                Some(_) => " AND s.project_cwd = ?",
                None => "",
            },
        );
        let mut projects_binds: Vec<&dyn ToSql> = vec![&cutoff];
        if let Some(ref p) = project {
            projects_binds.push(p);
        }
        let projects: i64 = self
            .conn
            .query_row(&projects_sql, params_from_iter(projects_binds.iter().copied()), |r| r.get(0))
            .unwrap_or(0);

        let messages_per_session =
            if sessions == 0 { 0.0 } else { messages as f64 / sessions as f64 };

        StatsCards {
            sessions,
            messages,
            user_messages,
            projects,
            active_days,
            messages_per_session,
            output_tokens,
        }
    }

    /// Per-model output-token totals over the range, for a rough cost card.
    /// NULL-model sessions are omitted (their tokens can't be priced) but are
    /// still part of `cards.output_tokens`.
    fn stats_range_models(&self, cutoff: &str, project: Option<&str>) -> Vec<ModelTokens> {
        // This query already JOINs `sessions s`, so scoping is a direct
        // `s.project_cwd = ?` rather than the id-subquery form.
        let sql = format!(
            "SELECT s.model, COALESCE(SUM(a.output_tokens),0)
             FROM activity a JOIN sessions s ON s.id = a.session_id
             WHERE a.date >= ?{} AND s.model IS NOT NULL
             GROUP BY s.model ORDER BY s.model",
            match project {
                Some(_) => " AND s.project_cwd = ?",
                None => "",
            },
        );
        let mut binds: Vec<&dyn ToSql> = vec![&cutoff];
        if let Some(ref p) = project {
            binds.push(p);
        }
        let Ok(mut stmt) = self.conn.prepare(&sql) else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map(params_from_iter(binds.iter().copied()), |r| {
            Ok(ModelTokens { model: r.get(0)?, output_tokens: r.get(1)? })
        }) else {
            return Vec::new();
        };
        rows.flatten().collect()
    }

    fn stats_heatmap(&self, cutoff: &str, project: Option<&str>) -> Vec<HeatmapDay> {
        let sql = format!(
            "SELECT date, COALESCE(SUM(messages),0), COUNT(DISTINCT session_id),
                    COALESCE(SUM(output_tokens),0)
             FROM activity WHERE date >= ?{} GROUP BY date ORDER BY date ASC",
            activity_project_clause(project),
        );
        let mut binds: Vec<&dyn ToSql> = vec![&cutoff];
        if let Some(ref p) = project {
            binds.push(p);
        }
        let Ok(mut stmt) = self.conn.prepare(&sql) else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map(params_from_iter(binds.iter().copied()), |r| {
            Ok(HeatmapDay {
                date: r.get(0)?,
                messages: r.get(1)?,
                sessions: r.get(2)?,
                output_tokens: r.get(3)?,
            })
        }) else {
            return Vec::new();
        };
        rows.flatten().collect()
    }

    /// All-time reads straight from `sessions`; a range filters to ids with
    /// activity in that window (a JOIN on the filtered activity ids).
    fn stats_top_by_messages(&self, days: Option<i64>, cutoff: &str, project: Option<&str>) -> Vec<TopSession> {
        // `where_parts` are ANDed together; binds are pushed in the same order
        // the `?` placeholders appear so `params_from_iter` lines them up.
        let mut where_parts: Vec<&str> = Vec::new();
        let mut binds: Vec<&dyn ToSql> = Vec::new();
        if days.is_some() {
            where_parts.push("id IN (SELECT DISTINCT session_id FROM activity WHERE date >= ?)");
            binds.push(&cutoff);
        }
        if let Some(ref p) = project {
            where_parts.push("project_cwd = ?");
            binds.push(p);
        }
        let where_clause =
            if where_parts.is_empty() { String::new() } else { format!("WHERE {}", where_parts.join(" AND ")) };
        let sql = format!(
            "SELECT id, agent, title, project_cwd, message_count FROM sessions
             {where_clause} ORDER BY message_count DESC LIMIT 10",
        );
        query_top_sessions(&self.conn, &sql, &binds)
    }

    fn stats_top_by_tokens(&self, days: Option<i64>, cutoff: &str, project: Option<&str>) -> Vec<TopSession> {
        // `output_tokens IS NOT NULL` is always present; the range and project
        // filters append after it, with binds pushed in placeholder order.
        let mut where_parts: Vec<&str> = vec!["output_tokens IS NOT NULL"];
        let mut binds: Vec<&dyn ToSql> = Vec::new();
        if days.is_some() {
            where_parts.push("id IN (SELECT DISTINCT session_id FROM activity WHERE date >= ?)");
            binds.push(&cutoff);
        }
        if let Some(ref p) = project {
            where_parts.push("project_cwd = ?");
            binds.push(p);
        }
        let sql = format!(
            "SELECT id, agent, title, project_cwd, output_tokens FROM sessions
             WHERE {} ORDER BY output_tokens DESC LIMIT 10",
            where_parts.join(" AND "),
        );
        query_top_sessions(&self.conn, &sql, &binds)
    }

    /// Fixed last-7-local-days window, independent of the `days` filter
    /// used for the rest of the dashboard.
    fn stats_weekly(&self, project: Option<&str>) -> Vec<WeeklyAgentRow> {
        let cutoff = (Local::now().date_naive() - Duration::days(6)).format("%Y-%m-%d").to_string();
        // Both queries JOIN `sessions s`, so scoping is a direct `s.project_cwd = ?`.
        let scope = match project {
            Some(_) => " AND s.project_cwd = ?",
            None => "",
        };

        let agent_sql = format!(
            "SELECT s.agent, COUNT(DISTINCT a.session_id), COALESCE(SUM(a.messages),0),
                    COALESCE(SUM(a.output_tokens),0)
             FROM activity a JOIN sessions s ON s.id = a.session_id
             WHERE a.date >= ?{scope}
             GROUP BY s.agent ORDER BY s.agent",
        );
        let mut agent_binds: Vec<&dyn ToSql> = vec![&cutoff];
        if let Some(ref p) = project {
            agent_binds.push(p);
        }
        let Ok(mut stmt) = self.conn.prepare(&agent_sql) else {
            return Vec::new();
        };
        let Ok(agent_rows) = stmt.query_map(params_from_iter(agent_binds.iter().copied()), |r| {
            Ok(WeeklyAgentRow {
                agent: r.get(0)?,
                sessions: r.get(1)?,
                messages: r.get(2)?,
                output_tokens: r.get(3)?,
                models: Vec::new(),
            })
        }) else {
            return Vec::new();
        };
        let mut rows: Vec<WeeklyAgentRow> = agent_rows.flatten().collect();

        // Per-model output tokens, grouped alongside agent; a NULL model is
        // skipped from the `models` breakdown but its tokens are already
        // counted in the agent-level total above.
        let model_sql = format!(
            "SELECT s.agent, s.model, COALESCE(SUM(a.output_tokens),0)
             FROM activity a JOIN sessions s ON s.id = a.session_id
             WHERE a.date >= ? AND s.model IS NOT NULL{scope}
             GROUP BY s.agent, s.model ORDER BY s.agent, s.model",
        );
        let mut model_binds: Vec<&dyn ToSql> = vec![&cutoff];
        if let Some(ref p) = project {
            model_binds.push(p);
        }
        let Ok(mut model_stmt) = self.conn.prepare(&model_sql) else {
            return rows;
        };
        let Ok(model_rows) = model_stmt.query_map(params_from_iter(model_binds.iter().copied()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        }) else {
            return rows;
        };
        for (agent, model, output_tokens) in model_rows.flatten() {
            if let Some(row) = rows.iter_mut().find(|row| row.agent == agent) {
                row.models.push(ModelTokens { model, output_tokens });
            }
        }

        rows
    }

    /// Per-project aggregates + this project's recent sessions. Filtered to
    /// `project_cwd = ?1`. An unknown project yields zeroed counts and an empty
    /// `recent` — never an error.
    pub fn project_stats(&self, project_cwd: &str) -> ProjectStats {
        let (sessions, messages, output_tokens, first_at, last_at) = self
            .conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(message_count),0), COALESCE(SUM(output_tokens),0),
                        COALESCE(MIN(started_at),0), COALESCE(MAX(ended_at),0)
                 FROM sessions WHERE project_cwd = ?1",
                params![project_cwd],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap_or((0, 0, 0, 0, 0));

        let active_days = self
            .conn
            .query_row(
                "SELECT COUNT(DISTINCT a.date) FROM activity a
                 JOIN sessions s ON s.id = a.session_id WHERE s.project_cwd = ?1",
                params![project_cwd],
                |r| r.get(0),
            )
            .unwrap_or(0);

        let top_model = self
            .conn
            .query_row(
                "SELECT model FROM sessions WHERE project_cwd = ?1 AND model IS NOT NULL
                 GROUP BY model ORDER BY COUNT(*) DESC, model ASC LIMIT 1",
                params![project_cwd],
                |r| r.get(0),
            )
            .ok();

        let recent = self.list_for_project(project_cwd);

        ProjectStats {
            project_cwd: project_cwd.to_string(),
            sessions,
            messages,
            output_tokens,
            active_days,
            top_model,
            first_at,
            last_at,
            recent,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::sessions_index::types::{ActivityBucket, ParsedSession};

    /// Builds a `ParsedSession` with a single activity bucket on `date`, so
    /// each fixture session contributes exactly one heatmap/weekly row.
    #[allow(clippy::too_many_arguments)]
    fn session(
        id: &str,
        agent: &'static str,
        project_cwd: &str,
        message_count: i64,
        user_message_count: i64,
        output_tokens: Option<i64>,
        model: Option<&str>,
        date: &str,
    ) -> ParsedSession {
        ParsedSession {
            id: id.into(),
            agent,
            project_cwd: project_cwd.into(),
            title: format!("session {id}"),
            started_at: 1000,
            ended_at: 2000,
            message_count,
            user_message_count,
            output_tokens,
            model: model.map(String::from),
            activity: vec![ActivityBucket {
                date: date.into(),
                hour: 9,
                messages: message_count,
                user_messages: user_message_count,
                output_tokens: output_tokens.unwrap_or(0),
            }],
        }
    }

    fn temp_db(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tt-sessions-stats-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("index.db")
    }

    fn day_string(days_ago: i64) -> String {
        (Local::now().date_naive() - Duration::days(days_ago)).format("%Y-%m-%d").to_string()
    }

    /// 3 sessions across 2 agents (claude, codex) and 2 projects (A, B):
    /// - s1: claude, project A, today, has tokens+model — biggest by messages and tokens.
    /// - s2: codex, project B, 3 days ago, no tokens.
    /// - s3: claude, project A, 40 days ago (outside the 30-day window and
    ///   outside the 7-day weekly window), no tokens.
    fn seeded_index(tag: &str) -> Index {
        let index = Index::open(&temp_db(tag)).unwrap();
        index
            .upsert_session(
                &session("s1", "claude", "/tmp/proj-a", 10, 5, Some(100), Some("claude-sonnet-5"), &day_string(0)),
                "/f/s1.jsonl",
                1,
                1,
            )
            .unwrap();
        index
            .upsert_session(
                &session("s2", "codex", "/tmp/proj-b", 6, 3, None, None, &day_string(3)),
                "/f/s2.jsonl",
                1,
                1,
            )
            .unwrap();
        index
            .upsert_session(
                &session("s3", "claude", "/tmp/proj-a", 4, 2, None, None, &day_string(40)),
                "/f/s3.jsonl",
                1,
                1,
            )
            .unwrap();
        index
    }

    #[test]
    fn empty_index_yields_zeroed_stats() {
        let index = Index::open(&temp_db("empty")).unwrap();
        let stats = index.stats(None, None);
        assert_eq!(stats.cards.sessions, 0);
        assert_eq!(stats.cards.messages, 0);
        assert_eq!(stats.cards.user_messages, 0);
        assert_eq!(stats.cards.projects, 0);
        assert_eq!(stats.cards.active_days, 0);
        assert_eq!(stats.cards.messages_per_session, 0.0);
        assert_eq!(stats.cards.output_tokens, 0);
        assert!(stats.heatmap.is_empty());
        assert!(stats.top_by_messages.is_empty());
        assert!(stats.top_by_tokens.is_empty());
        assert!(stats.weekly.is_empty());
        assert!(stats.range_models.is_empty());
    }

    #[test]
    fn all_time_cards_aggregate_every_session() {
        let index = seeded_index("cards-all-time");
        let stats = index.stats(None, None);
        assert_eq!(stats.cards.sessions, 3);
        assert_eq!(stats.cards.messages, 20); // 10 + 6 + 4
        assert_eq!(stats.cards.user_messages, 10); // 5 + 3 + 2
        assert_eq!(stats.cards.projects, 2);
        assert_eq!(stats.cards.active_days, 3);
        assert!((stats.cards.messages_per_session - (20.0 / 3.0)).abs() < 1e-9);
        // Only s1 carries tokens (100 on claude-sonnet-5).
        assert_eq!(stats.cards.output_tokens, 100);
        assert_eq!(
            stats.range_models,
            vec![ModelTokens { model: "claude-sonnet-5".into(), output_tokens: 100 }]
        );
    }

    #[test]
    fn project_scope_limits_every_aggregate_to_one_project() {
        let index = seeded_index("stats-project-scope");
        // Project A holds s1 (today, 10 msgs, 100 tokens) and s3 (40 days ago,
        // 4 msgs). Project B holds s2 (codex). Scoping to A, all-time, must
        // exclude s2 everywhere.
        let stats = index.stats(None, Some("/tmp/proj-a"));

        assert_eq!(stats.cards.sessions, 2); // s1 + s3, not s2
        assert_eq!(stats.cards.messages, 14); // 10 + 4
        assert_eq!(stats.cards.projects, 1); // only project A
        assert_eq!(stats.cards.output_tokens, 100); // only s1 has tokens

        // Top lists never leak project B's session.
        assert!(stats.top_by_messages.iter().all(|t| t.project_cwd == "/tmp/proj-a"));
        assert_eq!(stats.top_by_messages.len(), 2);
        assert!(stats.top_by_tokens.iter().all(|t| t.project_cwd == "/tmp/proj-a"));

        // Weekly (last 7 days) sees only s1 from project A (claude), not s2 (codex).
        assert_eq!(stats.weekly.len(), 1);
        assert_eq!(stats.weekly[0].agent, "claude");

        // Heatmap dates belong only to project A's sessions (today + 40 days ago).
        assert_eq!(stats.heatmap.len(), 2);
    }

    #[test]
    fn project_scope_for_unknown_project_is_empty() {
        let index = seeded_index("stats-project-unknown");
        let stats = index.stats(None, Some("/tmp/nope"));
        assert_eq!(stats.cards.sessions, 0);
        assert_eq!(stats.cards.messages, 0);
        assert!(stats.top_by_messages.is_empty());
        assert!(stats.weekly.is_empty());
        assert!(stats.heatmap.is_empty());
    }

    #[test]
    fn range_filter_excludes_out_of_window_tokens_from_the_cards() {
        let index = seeded_index("cards-ranged-tokens");
        // s1 (today, 100 tokens) is in the 30-day window; s3 (40 days ago) is
        // out. s1 is the only token-bearing session, so both windows total 100,
        // but this pins that the token sum honors the cutoff like the counts do.
        let stats = index.stats(Some(30), None);
        assert_eq!(stats.cards.output_tokens, 100);
        assert_eq!(stats.range_models.len(), 1);
    }

    #[test]
    fn thirty_day_filter_excludes_the_old_sessions_activity() {
        let index = seeded_index("cards-30d");
        let stats = index.stats(Some(30), None);
        assert_eq!(stats.cards.sessions, 2); // s1, s2 only
        assert_eq!(stats.cards.messages, 16); // 10 + 6
        assert_eq!(stats.cards.user_messages, 8); // 5 + 3
        assert_eq!(stats.cards.projects, 2); // project A (s1) + project B (s2)
        assert_eq!(stats.cards.active_days, 2);
        assert_eq!(stats.cards.messages_per_session, 8.0);
    }

    #[test]
    fn heatmap_is_ascending_by_date() {
        let index = seeded_index("heatmap");
        let stats = index.stats(None, None);
        assert_eq!(stats.heatmap.len(), 3);
        let dates: Vec<&str> = stats.heatmap.iter().map(|d| d.date.as_str()).collect();
        let mut sorted = dates.clone();
        sorted.sort();
        assert_eq!(dates, sorted);
    }

    #[test]
    fn hourly_is_length_24_and_buckets_todays_messages_by_hour() {
        let index = seeded_index("hourly");
        let stats = index.stats(None, None);
        assert_eq!(stats.hourly.len(), 24);
        // Only today's session (s1: 10 messages on hour 9) counts — s2 (3 days
        // ago) and s3 (40 days ago) are excluded from the today-only view.
        assert_eq!(stats.hourly[9], 10);
        assert_eq!(stats.hourly.iter().sum::<i64>(), 10);
    }

    #[test]
    fn heatmap_carries_messages_sessions_and_tokens_per_day() {
        let index = seeded_index("heatmap-metrics");
        let stats = index.stats(None, None);
        // s1 is today with 10 messages, 1 session, 100 output tokens.
        let today = day_string(0);
        let day = stats.heatmap.iter().find(|d| d.date == today).unwrap();
        assert_eq!(day.messages, 10);
        assert_eq!(day.sessions, 1);
        assert_eq!(day.output_tokens, 100);
    }

    #[test]
    fn top_by_messages_orders_descending() {
        let index = seeded_index("top-messages");
        let stats = index.stats(None, None);
        let ids: Vec<&str> = stats.top_by_messages.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["s1", "s2", "s3"]);
        assert_eq!(stats.top_by_messages[0].value, 10);
    }

    #[test]
    fn top_by_tokens_excludes_sessions_without_tokens() {
        let index = seeded_index("top-tokens");
        let stats = index.stats(None, None);
        assert_eq!(stats.top_by_tokens.len(), 1);
        assert_eq!(stats.top_by_tokens[0].id, "s1");
        assert_eq!(stats.top_by_tokens[0].value, 100);
    }

    #[test]
    fn weekly_window_only_counts_last_7_days_regardless_of_days_filter() {
        let index = seeded_index("weekly");
        // Use an all-time call — weekly must still restrict itself to 7 days.
        let stats = index.stats(None, None);
        assert_eq!(stats.weekly.len(), 2); // claude, codex — s3 (40d old) excluded

        let claude = stats.weekly.iter().find(|r| r.agent == "claude").unwrap();
        assert_eq!(claude.sessions, 1); // only s1, not s3
        assert_eq!(claude.messages, 10);
        assert_eq!(claude.output_tokens, 100);
        assert_eq!(claude.models.len(), 1);
        assert_eq!(claude.models[0].model, "claude-sonnet-5");
        assert_eq!(claude.models[0].output_tokens, 100);

        let codex = stats.weekly.iter().find(|r| r.agent == "codex").unwrap();
        assert_eq!(codex.sessions, 1);
        assert_eq!(codex.messages, 6);
        assert_eq!(codex.output_tokens, 0);
        assert!(codex.models.is_empty()); // model was None
    }

    #[test]
    fn project_stats_aggregates_only_that_project() {
        let index = seeded_index("proj-stats");
        let ps = index.project_stats("/tmp/proj-a");
        // proj-a = s1 (10 msg, 100 tok, sonnet-5, today) + s3 (4 msg, 0 tok, 40d ago).
        assert_eq!(ps.project_cwd, "/tmp/proj-a");
        assert_eq!(ps.sessions, 2);
        assert_eq!(ps.messages, 14);
        assert_eq!(ps.output_tokens, 100);
        assert_eq!(ps.active_days, 2);
        assert_eq!(ps.top_model.as_deref(), Some("claude-sonnet-5"));
        // recent is newest-first by ended_at; both fixture sessions share ended_at,
        // so just assert membership and count.
        assert_eq!(ps.recent.len(), 2);
        assert!(ps.recent.iter().all(|s| s.project_cwd == "/tmp/proj-a"));
    }

    #[test]
    fn project_stats_is_zeroed_for_an_unknown_project() {
        let index = seeded_index("proj-stats-none");
        let ps = index.project_stats("/tmp/does-not-exist");
        assert_eq!(ps.sessions, 0);
        assert_eq!(ps.messages, 0);
        assert_eq!(ps.output_tokens, 0);
        assert_eq!(ps.active_days, 0);
        assert_eq!(ps.top_model, None);
        assert_eq!(ps.first_at, 0);
        assert_eq!(ps.last_at, 0);
        assert!(ps.recent.is_empty());
    }
}
