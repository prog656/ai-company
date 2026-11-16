# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [SemVer](https://semver.org/).

## [0.4.0] - 2026-11-16

### Fixed

- **Relaying a memo now actually hands it to the staff member.** The button used
  to only write a flag — the employee never saw the memo, so the gate was
  decorative. Now the target receives the text, acts on it, replies in the group,
  and may write a new memo of its own. Verified end-to-end: the reviewer flagged
  invented revenue figures, the writer took the memo over, rewrote the deck, and
  reported back that the 12M number was reverse-engineered from nothing.
- Relay is now rejected when the staff is busy, when the memo was already sent,
  or when the target is the memo's author.

### Changed

- Memo card reads 已交给 instead of 已转给 — because it now actually is.

## [0.3.0] - 2026-11-16

### Changed

- Interface rewritten: dark theme, per-role gradient avatars, entry motion
- Tabs renamed to plain words: 对话 / 团队 / 文件 (was 群里 / 花名册 / 交付)
- Roster cards lead with the role instead of the engine — three staff all named
  "DeepSeek" were indistinguishable
- Composer hidden when there is no staff; a single hire button takes its place
- Hire sheet lists only connected engines; unconfigured ones collapse into one hint

### Fixed

- The badge on the roster tab always read `0` — the count was never implemented
- Long deliverable paths broke the card layout
- "Memo destroyed" rows piling up after every restart
- Desktop scrollbars rendering as bright white bars

### Removed

- Development leftovers (`docs/legacy-cli.mjs`, `docs/prototype-app.html`)

## [0.2.0] - 2026-11-16

### Added

- Memos encrypted at rest with AES-256-GCM
- Deliverables written to `workspace/deliverables/` as real markdown files
- `workspace/roster.md` so staff never need to look inside internal data
- Same-origin check on POST requests
- `DATA_DIR` / `WORK_DIR` / `NO_OPEN` environment variables

### Changed

- Runtime data split into `data/`; staff working directory isolated to `workspace/`
- Server listens on `127.0.0.1` by default

### Fixed

- DSH error events were swallowed — the UI said "done" while staff produced nothing
- Old sessions could not resume after the working directory moved; staff are
  now re-hired automatically instead of failing silently
- Messages lost while the SSE connection was down

### Security

- Encryption key lives in process memory only; nothing written to disk

## [0.1.0] - 2026-11-16

### Added

- First release: a boss, hired staff, and three channels (group / DM / secret memo)
- Roles and workflow defined in `company/roles/*.md` and `company/workflow.json`
- Staff keep persistent memory across jobs via DSH sessions

