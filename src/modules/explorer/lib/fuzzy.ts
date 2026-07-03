/**
 * Lightweight fuzzy subsequence matcher for the file finder. Returns whether
 * the query matches, a score (higher is better) and the matched character
 * indices for highlighting.
 */

export interface FuzzyResult {
  matched: boolean;
  score: number;
  indices: number[];
}

const SEPARATORS = "/\\_-. ";

/**
 * A query with multiple space-separated words requires each word to match
 * somewhere in the target (in any order relative to each other) rather than
 * being matched as one literal subsequence including the space character —
 * paths never contain a literal space, so a single-pass match would always
 * fail once the query had more than one word in it.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  return matchWords(parseQueryWords(query), target);
}

/**
 * Lowercased, whitespace-split query words. `fuzzyRank` calls this once per
 * keystroke and reuses the result across every candidate item, rather than
 * re-parsing (and re-lowercasing) the same query once per item.
 */
function parseQueryWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Matches a target against pre-parsed (already-lowercased) query words. */
function matchWords(words: string[], target: string): FuzzyResult {
  if (words.length === 0) {
    return { matched: true, score: 0, indices: [] };
  }

  const t = target.toLowerCase();
  let score = 0;
  const indices = new Set<number>();
  for (const word of words) {
    const result = matchWord(word, t);
    if (!result.matched) {
      return { matched: false, score: 0, indices: [] };
    }
    score += result.score;
    for (const index of result.indices) {
      indices.add(index);
    }
  }
  return { matched: true, score, indices: [...indices].sort((a, b) => a - b) };
}

/** Matches a single already-lowercased word as a subsequence of `t`, the already-lowercased target. */
function matchWord(q: string, t: string): FuzzyResult {
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prevMatch = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) {
      continue;
    }
    indices.push(ti);
    // Reward contiguous runs and matches at word boundaries.
    if (prevMatch === ti - 1) {
      score += 6;
    } else {
      score += 1;
    }
    if (ti === 0 || SEPARATORS.includes(t[ti - 1])) {
      score += 4;
    }
    prevMatch = ti;
    qi += 1;
  }

  if (qi !== q.length) {
    return { matched: false, score: 0, indices: [] };
  }

  // Slightly prefer shorter targets.
  score -= Math.floor(t.length / 24);
  return { matched: true, score, indices };
}

/**
 * Filter and rank a list of strings against a query, best match first. Ties
 * fall back to alphabetical order for stable output.
 */
export function fuzzyRank(query: string, items: string[]): string[] {
  if (query === "") {
    return [...items];
  }
  const words = parseQueryWords(query);
  return items
    .map((item) => ({ item, result: matchWords(words, item) }))
    .filter((entry) => entry.result.matched)
    .sort(
      (a, b) =>
        b.result.score - a.result.score || a.item.localeCompare(b.item),
    )
    .map((entry) => entry.item);
}
