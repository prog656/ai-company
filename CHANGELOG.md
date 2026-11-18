# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [SemVer](https://semver.org/).

## [0.5.3] - 2026-11-18

### Fixed

- **端口被占用时会甩一脸红色堆栈。** 第二次双击 `start.bat`（或者上一次的窗口没关），
  用户看到的是 `EADDRINUSE` 和一整段调用栈，第一反应是「这软件坏了」。
  现在改成说人话：告诉他是端口被占、多半是旧窗口没关，并且**自动把已经在跑的那个页面打开**。

## [0.5.2] - 2026-11-18

### Fixed

- **`start.bat` 调用了一个不存在的文件。** 它执行 `node run.mjs`，而入口是
  `server.mjs`，所以双击启动器——README 让你做的第一件事——会直接死在
  `Cannot find module 'run.mjs'`。v0.5.0 和 v0.5.1 的下载包都有这个问题。

## [0.5.1] - 2026-11-16

### Fixed

- **The download shipped a README with no usage guide.** v0.5.0 was tagged
  before that section was written, so anyone who grabbed the zip got a manual
  that explained how to install and nothing about what to do next.
- The quick-start heading said "three steps" for a section that is actually
  two paths of three steps each.

## [0.5.0] - 2026-11-16

### Added

- **每个员工可以跑在不同的模型上。** 引擎配置现在带 `provider` + `model`，
  每次叫醒员工都会写一份 profile patch 覆盖 `agent-default-model` ——
  同一个 DSH，不同员工不同脑子。
- 自带两个真选项：`deepseek-flash`（快，写作和调度）与 `deepseek-reasoner`
  （慢，但会反复推敲，适合审稿）。
- **外部 AI 可以直接当员工。** 任何 OpenAI 兼容接口 —— 豆包、Kimi、本地
  Ollama 跑的开源模型、LM Studio、vLLM —— 在 `engines.json` 里写一行就能招。
  代价必须说清楚：这些员工**只有嘴，没有手脚**，不能读写文件、不能跑命令，
  适合写手和审稿，不适合要翻证据的调研。
- 密钥只从环境变量读（`DOUBAO_API_KEY` / `MOONSHOT_API_KEY`），不落到任何文件。

### Verified

- 用一个本地假 API 顶替 MiMo 当写手：它出了稿，DeepSeek 的审稿人接过去照审，
  并且挑出「标题里带着调试占位符」这个问题。**跨厂商协作这条路是通的。**
- 审稿人换到 `deepseek-reasoner` 后耗时 10.8 秒，并且**自己去读了三个文件**
  才下判断；同一个岗位用 `deepseek-flash` 时只凭提示词作答。
- 把模型名故意写成不存在的值，员工**一个字都产不出来** —— 这证明 patch
  确实传到了 DSH 并且被采纳，不是被静默忽略。

### Fixed

- `--patch` 必须排在应用参数之前；此前放在 `--json` 后面，headless 直接报
  `unknown option '--patch'`。
- 员工记录原先存的是引擎显示名，现在存 id，并保留按名字查找的兼容分支，
  老名册不会因为改名而失效。

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

