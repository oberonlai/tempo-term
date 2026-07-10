---
name: build
description: Use when the user asks to ship a change and/or package the app for this tempo-term repo — commit, push, open a PR to the upstream author (mukiwu), and build the macOS (.dmg) and/or Windows (.exe/.msi) apps. Encodes this fork's branch model, the local unsigned-build override, and the Windows-via-CI path.
---

# build — ship & package tempo-term

This repo is a **fork** of `mukiwu/tempo-term`. Two remotes: `origin` = the user's fork (`oberonlai/tempo-term`), `upstream` = the author (`mukiwu/tempo-term`). The dev box is macOS; there is **no code-signing key** on it (`~/.tauri/tempo-term.key` is absent) and `tauri.conf.json` sets a Developer ID `signingIdentity` + `createUpdaterArtifacts: true`. Windows **cannot** be cross-compiled locally (native crates) — it builds on CI only.

## Branch model (do not violate)

- **`master`** — always equals `upstream/master`. Keep it clean. Every change starts as a `feat/*` or `fix/*` branch off master; PRs to the author come from those branches.
- **`personal`** — long-lived integration branch that merges ALL of the user's feature branches. It is what you build/package for local use. It intentionally has `createUpdaterArtifacts: false` so Windows CI needs no signing secret.
- Never merge feature branches into `master`. After finishing a `feat/*`: open the PR **and** merge it into `personal`.

See the auto-memory `personal-integration-branch-workflow` for the full rationale.

## A. Ship a change (commit → push → PR to author)

Run these on the **feature branch** the work lives on (never `master`). Confirm first: `git branch --show-current`.

```bash
# 1. Commit (Traditional-Chinese conventional message: feat|fix|chore(scope): …)
git add -A && git commit -m "<type>(<scope>): <繁中簡述>"

# 2. Push the feature branch to the fork
git push -u origin <feat/branch>

# 3. Open a PR to the upstream author
gh pr create --repo mukiwu/tempo-term --base master --head oberonlai:<feat/branch> \
  --title "<type>(<scope>): <title>" --body "<summary + 測試 + 備註>"

# 4. Propagate to the user's local build branch
git switch personal && git merge --no-edit <feat/branch> && git push origin personal
```

Commit-message footers (per the user's global rules):

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: <the session URL from the environment>
```

PR body ends with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

Verify before pushing/PR: `pnpm typecheck`, `pnpm test`, and `cd src-tauri && cargo test` as relevant to the change.

## B. Package the macOS app (.dmg, local, unsigned)

Build from `personal` (all features). Uses a config override so the missing Developer ID / updater key don't fail the build — **do not edit `tauri.conf.json`**.

```bash
git switch personal
# No --target: the aarch64-apple-darwin rustup target may be unregistered; the
# host default builds the arm64 bundle fine. (Passing --target aarch64-apple-darwin
# errors with "target does not exist" on this box.)
pnpm tauri build --config .claude/skills/build/nosign.tauri.json
```

Artifacts land at (version = `tauri.conf.json` `version`, currently `0.0.16`):

- `src-tauri/target/release/bundle/dmg/TempoTerm_<ver>_aarch64.dmg`
- `src-tauri/target/release/bundle/macos/TempoTerm.app`

The DMG's `bundle_dmg.sh` step is slow and the CLI prints `Finished 2 bundles` only after it; wait for the `.dmg` file to actually exist before copying. Deliver by copying to `~/Downloads/tempoterm-full-<ver>/`.

Unsigned ⇒ Gatekeeper blocks first launch: right-click → Open, or `xattr -dr com.apple.quarantine <app>`.

## C. Package the Windows app (.exe/.msi, via CI)

No local cross-compile. Dispatch the fork's workflow on a branch whose `createUpdaterArtifacts` is `false` (i.e. `personal`; the fork's `TAURI_SIGNING_PRIVATE_KEY` secret is currently broken, so a branch with the flag `true` fails at the signing step even though the installers built).

```bash
git push origin personal                      # make sure the ref is current
gh workflow run windows-build.yml --repo oberonlai/tempo-term --ref personal
# find the run id, then wait for it to finish (build ~10-15 min):
gh run list --repo oberonlai/tempo-term --workflow windows-build.yml --branch personal --limit 1
# on success, download the artifact:
gh run download <run-id> --repo oberonlai/tempo-term -n tempoterm-windows-x86_64 \
  -D ~/Downloads/tempoterm-full-<ver>
```

Produces `nsis/TempoTerm_<ver>_x64-setup.exe` and `msi/TempoTerm_<ver>_x64_en-US.msi`. Unsigned ⇒ SmartScreen warns: "More info" → "Run anyway".

To watch the CI run without polling in-band, use a Monitor that emits when `gh run view <id> --json status` reports `completed`.

## Notes / pitfalls

- **`shell` on macOS**: `timeout` is not installed (it's `gtimeout`); don't rely on it.
- **Windows CI failure signature** `incorrect updater private key password: Missing comment in secret key` = the fork's signing secret is bad. Building from a `createUpdaterArtifacts: false` branch sidesteps it. A real fix needs the author to set the fork's `TAURI_SIGNING_PRIVATE_KEY` to the correct minisign key.
- **Version** is the single source of truth in `src-tauri/tauri.conf.json` (`version`). Read it to fill `<ver>` in artifact paths.
- These local/CI builds are **unsigned, for testing only** — real releases go out from the author's `master` via `scripts/release.sh`, not from here.
