// AI 工作室 · 本地服务
// 零依赖：只用 Node 内置模块，不装任何 npm 包。
// 启动：node server.mjs  →  浏览器打开 http://localhost:4173
//
// 三个目录，各管各的：
//   company/    公司定义（岗位、流程、引擎）——进仓库
//   data/       内部数据（名册、消息、密报）——不进仓库，密报加密
//   workspace/  员工的工作区，也是他们的 cwd ——不进仓库
//
// 员工只在自己的工作区里干活。公司账本在他们看不到的地方，而且密报是密文。

import http from "node:http";
import { spawn, exec } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// 读 .env（如果存在）。给不想折腾环境变量的人一条路：
// 在项目根建一个 .env，写 DOUBAO_API_KEY=xxx，重启即可。
// .env 已经在 .gitignore 里，不会被提交。
{
  const envFile = join(HERE, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#") && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
const CONF_DIR = join(HERE, "company");
// data / workspace 可以用环境变量指到别处：多开测试、或者把员工工作区放到另一块盘
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(HERE, "data");
const WORK_DIR = process.env.WORK_DIR ? resolve(process.env.WORK_DIR) : join(HERE, "workspace");
const PORT = Number(process.env.PORT || 4173);
// 默认只听本机。想在手机上用（同一个 WiFi），启动前设 HOST=0.0.0.0，
// 但要清楚：那意味着同一网络里的任何人都能打开你的公司。
const HOST = process.env.HOST || "127.0.0.1";

function ensureDirs() {
  [DATA_DIR, WORK_DIR, join(WORK_DIR, "deliverables")].forEach((d) => {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  });
}

// ---------- 密报加密 ----------
// 用 AES-256-GCM。密钥首次运行随机生成，也可以由环境变量 COMPANY_KEY 提供（64 位 hex）。
// 注意：密钥和密文在同一台机器上，这不是防恶意攻击，是防止员工 glob/grep 时读到明文。
const KEY_FILE = join(DATA_DIR, ".key");

// 密钥策略 —— 这是个真实取舍，README 里照实写了：
//   默认：每次启动随机生成，只存在内存里。重启后旧密报解不出来，但地球上没人能读。
//   想保留密报历史：设环境变量 COMPANY_KEY（64 位 hex）。代价是密钥在这台机器上，
//   同一个用户身份理论上能读到——这是操作系统的边界，不是这个程序能解决的。
//   旧版本留下的 data/.key 仍然兼容，但启动时会提醒你删掉。
function loadKey() {
  if (process.env.COMPANY_KEY) {
    const b = Buffer.from(process.env.COMPANY_KEY, "hex");
    if (b.length === 32) return b;
    throw new Error("COMPANY_KEY 必须是 64 位十六进制字符串");
  }
  if (existsSync(KEY_FILE)) {
    const b = readFileSync(KEY_FILE);
    if (b.length === 32) {
      console.warn(
        "\n  注意：发现 data/.key —— 密报密钥落在磁盘上，同机程序可能读到。\n" +
          "        删掉它可提升安全性，但历史密报将无法解密。\n"
      );
      return b;
    }
  }
  return randomBytes(32);
}

let KEY = null;
const key = () => (KEY ||= loadKey());

function seal(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

function unseal(b64) {
  try {
    const buf = Buffer.from(b64, "base64");
    const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  } catch {
    // 密钥不在了（换了会话），这条密报已经没用了。
    // 返回 null，上层直接丢掉 —— 不显示一堆「已销毁」占着屏幕。
    return null;
  }
}

// 找 DSH 的 CLI。不要在这里写死任何人的安装路径 —— 换台机器就废了，
// 而且公开仓库里出现 C:\Users\xxx 这种字符串是很业余的。
// 顺序：环境变量 → 各盘符的标准安装位置 → LOCALAPPDATA。
function findDsh() {
  if (process.env.DSH_BIN && existsSync(process.env.DSH_BIN)) return process.env.DSH_BIN;

  const tail = ["resources", "runtime", "cli", "bin", "dsh.cmd"];
  const roots = [];

  if (process.platform === "win32") {
    for (const drive of ["C", "D", "E", "F", "G"]) {
      roots.push(join(`${drive}:\\`, "Program Files", "DeepSeek Harness"));
      roots.push(join(`${drive}:\\`, "Program Files (x86)", "DeepSeek Harness"));
    }
    if (process.env.LOCALAPPDATA) {
      roots.push(join(process.env.LOCALAPPDATA, "Programs", "DeepSeek Harness"));
    }
  } else {
    roots.push("/usr/local/lib/deepseek-harness", "/opt/deepseek-harness");
  }

  for (const r of roots) {
    const p = join(r, ...tail);
    if (existsSync(p)) return p;
  }
  return null;
}

const DSH = findDsh();

// ---------- 读公司定义 ----------
function parseMd(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  m[1].split(/\r?\n/).forEach((ln) => {
    const i = ln.indexOf(":");
    if (i > 0) meta[ln.slice(0, i).trim()] = ln.slice(i + 1).trim();
  });
  return { meta, body: m[2].trim() };
}

function readJson(p, fallback) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  ensureDirs();
  writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function loadRoles() {
  const dir = join(CONF_DIR, "roles");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const { meta, body } = parseMd(readFileSync(join(dir, f), "utf8"));
      const id = meta.id || f.replace(/\.md$/, "");
      return { id, name: meta.name || id, duty: meta.duty || "", body, file: f };
    });
}

const ROLES = loadRoles();
const WORKFLOW = readJson(join(CONF_DIR, "workflow.json"), { steps: [] });
const ENGINES = readJson(join(CONF_DIR, "engines.json"), []);

// ---------- 模板 ----------
function render(tpl, vars) {
  let s = tpl.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, k, body) =>
    vars[k] ? body : ""
  );
  s = s.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
  return s;
}

// ---------- 状态 ----------
// 内存里是完整的（含密报明文）；磁盘上拆四个文件，密报只存密文。
let state = { staff: [], messages: [], deliveries: [], seq: 0 };

function loadState() {
  ensureDirs();

  // 从旧版本迁移：数据曾经全存在 company/state.json 里
  const legacy = join(CONF_DIR, "state.json");
  if (existsSync(legacy) && !existsSync(join(DATA_DIR, "roster.json"))) {
    const old = readJson(legacy, null);
    if (old) {
      state = {
        staff: old.staff || [],
        messages: old.messages || [],
        deliveries: old.deliveries || [],
        seq: old.seq || 0,
      };
      save();
      try {
        renameSync(legacy, legacy + ".migrated");
      } catch {}
      return;
    }
  }

  const staff = readJson(join(DATA_DIR, "roster.json"), []);
  const log = readJson(join(DATA_DIR, "log.json"), []);
  const memos = [];
  for (const m of readJson(join(DATA_DIR, "memos.json"), [])) {
    const t = unseal(m.text);
    if (t !== null) memos.push({ ...m, text: t });
  }
  const deliveries = readJson(join(DATA_DIR, "deliveries.json"), []);
  const meta = readJson(join(DATA_DIR, "meta.json"), { seq: 0 });

  state = {
    staff,
    messages: [...log, ...memos].sort((a, b) => a.id - b.id),
    deliveries,
    seq: meta.seq || 0,
  };
}

function save() {
  ensureDirs();
  writeJson(join(DATA_DIR, "roster.json"), state.staff);
  writeJson(join(DATA_DIR, "deliveries.json"), state.deliveries);
  writeJson(join(DATA_DIR, "meta.json"), { seq: state.seq });
  writeJson(
    join(DATA_DIR, "log.json"),
    state.messages.filter((m) => m.kind !== "secret")
  );
  writeJson(
    join(DATA_DIR, "memos.json"),
    state.messages
      .filter((m) => m.kind === "secret")
      .map((m) => ({ ...m, text: seal(m.text) }))
  );
  syncRosterFile();
}

// 员工要查名册时，读这个文件就够了，不必去翻 data/
function syncRosterFile() {
  const lines = [
    "# 公司名册",
    "",
    "> 这是给你看的公开信息。公司内部数据和老板的密报不在这里，也不该去别处找。",
    "",
  ];
  if (!state.staff.length) lines.push("（目前没有在职员工）");
  else {
    lines.push("| 岗位 | 引擎 | 工号 |", "| --- | --- | --- |");
    state.staff.forEach((s) => lines.push(`| ${s.roleName} | ${s.engine} | ${s.id} |`));
  }
  writeFileSync(join(WORK_DIR, "roster.md"), lines.join("\n") + "\n", "utf8");
}

// ---------- SSE ----------
const clients = new Set();

function broadcast(ev) {
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) {
    try {
      c.write(payload);
    } catch {}
  }
}

function emit(msg) {
  const m = { id: ++state.seq, at: Date.now(), ...msg };
  state.messages.push(m);
  if (state.messages.length > 400) state.messages = state.messages.slice(-300);
  save();
  broadcast({ type: "message", msg: m });
  return m;
}

// ---------- 叫醒员工 ----------
// 每个员工用自己的模型：写一个 patch，覆盖 profile 里的 agent-default-model。
// 没配 model 的引擎（老数据、或还没填 provider 的）走默认模型。
const PATCH_DIR = join(DATA_DIR, "patches");

function engineOf(engineId) {
  // 新数据存 id，老数据存的是显示名，两种都认
  return ENGINES.find((e) => e.id === engineId) || ENGINES.find((e) => e.name === engineId) || null;
}

// 给前端的员工视图：把内部 id 换成能看懂的名字和模型名
function staffView() {
  return state.staff.map((s) => {
    const e = engineOf(s.engine);
    return { ...s, engineName: e ? e.name : s.engine, modelName: e ? e.model || "" : "" };
  });
}

function patchFor(engineId) {
  const eng = engineOf(engineId);
  if (!eng || !eng.provider || !eng.model) return null;
  try {
    mkdirSync(PATCH_DIR, { recursive: true });
    const p = join(PATCH_DIR, `${engineId}.yml`);
    const body = [
      "- id: agent-default-model",
      "  config:",
      `    provider: ${eng.provider}`,
      `    model: ${eng.model}`,
      "",
    ].join("\n");
    writeFileSync(p, body, "utf8");
    return p;
  } catch {
    // 写不进去就当没配，退回默认模型 —— 不要让整单因为一个人失败
    return null;
  }
}

// 纯 API 型员工：直接打 OpenAI 兼容接口（豆包 / Kimi / MiMo 的本地 Ollama 都吃这套）。
// 代价必须说清楚：它们没有手脚 —— 读写文件、跑命令一概做不了。
// 所以适合写手、审稿这类只动嘴的岗位，不适合要翻文件的调研。
async function hireApi(eng, staff, task) {
  // 本地模型（Ollama）不校验 key，不填 keyEnv 就是那个情况
  const key = eng.keyEnv ? process.env[eng.keyEnv] : "local";
  if (!key) throw new Error(`${eng.name} 没配密钥：请设置环境变量 ${eng.keyEnv}`);

  const url = `${String(eng.baseURL).replace(/\/+$/, "")}/chat/completions`;
  const t0 = Date.now();

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: eng.model,
      messages: [{ role: "user", content: task }],
      temperature: 0.7,
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${eng.name} 返回 ${r.status}：${t.slice(0, 180)}`);
  }

  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${eng.name} 返回了空内容`);

  emit({ kind: "tool", from: staff.id, text: `${eng.name}（${eng.model}，${((Date.now() - t0) / 1000).toFixed(1)}s）` });
  return text;
}

// 分流：api 型走 HTTP，其余走 DSH 的 CLI
async function hire(staff, task) {
  const eng = engineOf(staff.engine);
  if (eng && eng.type === "api") return hireApi(eng, staff, task);
  return hireCli(staff, task);
}

// cwd 是 workspace —— 员工只能看见自己办公室里的东西
function hireCli(staff, task) {
  return new Promise((resolve, reject) => {
    if (!DSH) return reject(new Error("没找到 DSH。请设置环境变量 DSH_BIN 指向 dsh.cmd"));

    // 顺序有讲究：--patch 是启动器的参数，必须排在 --json / --session-id 这些应用参数前面，
    // 否则 headless 会把它当成自己的参数并报 unknown option。
    const args = [`"${DSH}"`, "--profile", "headless"];

    const eng = ENGINES.find((e) => e.id === staff.engine);
    if (eng) emit({ kind: "tool", from: staff.id, text: `${eng.name}（${eng.model || "默认模型"}）` });
    const patch = patchFor(staff.engine);
    if (patch) args.push("--patch", `"${patch}"`);

    args.push("--json");
    if (staff.sessionId) args.push("--session-id", staff.sessionId);

    // 子进程环境里不放 COMPANY_KEY，防止员工读到密钥
    const env = { ...process.env };
    delete env.COMPANY_KEY;

    const child = spawn(args.join(" "), {
      shell: true,
      cwd: WORK_DIR,
      windowsHide: true,
      env,
    });

    let buf = "";
    let text = "";
    let sid = staff.sessionId || null;
    let errMsg = null;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const ln = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!ln) continue;
        let ev;
        try {
          ev = JSON.parse(ln);
        } catch {
          continue;
        }
        if (ev.type === "session") sid = ev.sessionId;
        else if (ev.type === "text") text += ev.text;
        else if (ev.type === "tool_call") emit({ kind: "tool", from: staff.id, text: ev.tool });
        else if (ev.type === "final") text = ev.text || text;
        else if (ev.type === "error") errMsg = ev.message || "未知错误";
      }
    });

    child.on("error", reject);
    child.on("close", () => {
      // 搬家了：DSH 的会话跟工作目录绑定，旧会话恢复不了。
      // 让他忘掉上一份工作、重新入职一次，总比整个公司静默瘫痪强。
      if (errMsg && /was recorded in/.test(errMsg) && staff.sessionId) {
        staff.sessionId = null;
        save();
        hire(staff, task).then(resolve).catch(reject);
        return;
      }
      if (errMsg && !text) {
        reject(new Error(errMsg));
        return;
      }
      if (sid && sid !== staff.sessionId) {
        staff.sessionId = sid;
        save();
      }
      resolve(text.trim());
    });

    child.stdin.write(task, "utf8");
    child.stdin.end();
  });
}

// ---------- 解析三层输出 ----------
function split(raw) {
  const out = { reply: "", dms: [], secret: "" };
  const re = /【(答复|@[^】\s]+|密报)】/g;
  const marks = [];
  let m;
  while ((m = re.exec(raw))) marks.push({ tag: m[1], start: m.index + m[0].length });
  if (!marks.length) {
    out.reply = raw.trim();
    return out;
  }
  const head = raw.slice(0, marks[0].start - marks[0].tag.length - 2).trim();
  if (head) out.reply = head;
  marks.forEach((mk, idx) => {
    const end =
      idx + 1 < marks.length ? marks[idx + 1].start - marks[idx + 1].tag.length - 2 : raw.length;
    const body = raw.slice(mk.start, end).trim();
    if (!body) return;
    if (mk.tag === "答复") out.reply = out.reply ? out.reply + "\n" + body : body;
    else if (mk.tag === "密报") out.secret = body;
    else out.dms.push({ to: mk.tag.slice(1), text: body });
  });
  return out;
}

const PROTOCOL = `
你的工作目录就是这间办公室，你只能读写这个目录里的文件。不要去访问上级目录，那里不归你管。

输出格式（严格照写，三层可以都有，没有就省略那一层）：

【答复】
给老板看的结论，直接说事，不要客套。

【@写手】
如果你需要直接跟同事说话，用这个，把岗位名换成任意同事的岗位。

【密报】
如果有只该让老板知道的事，写在这里。写了就代表不会通知任何人。
`;

const byRole = (roleId) => state.staff.find((s) => s.role === roleId && !s.gone);
const staffOf = (roleName) => {
  if (!roleName) return null;
  const r = ROLES.find((x) => x.name === roleName || x.id === roleName);
  return r ? byRole(r.id) : null;
};

// ---------- 交付落盘 ----------
function slug(s) {
  return (
    String(s)
      .replace(/[\\/:*?"<>|\r\n\t]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 16) || "deliverable"
  );
}

function writeDeliverable(title, body, byName) {
  const name = `${Date.now()}-${slug(title)}.md`;
  const p = join(WORK_DIR, "deliverables", name);
  const head = [
    `# ${title}`,
    "",
    `> 交付人：${byName}　时间：${new Date().toLocaleString("zh-CN")}`,
    "",
    "---",
    "",
  ].join("\n");
  writeFileSync(p, head + body + "\n", "utf8");
  return `workspace/deliverables/${name}`;
}

// ---------- 干一件活 ----------
let busy = false;

// 老板把一条密报转给某个员工。这是真的把内容交到他手上，他会读到、会回应。
// 原来的实现只写了 relayedTo 字段就完事，员工根本不知道有这回事 ——
// 界面上那个「转给谁」的按钮，实际上是个装饰品。
async function relayMemo(memo, staff) {
  busy = true;
  broadcast({ type: "busy", busy: true });

  try {
    const from = state.staff.find((s) => s.id === memo.from);
    const fromWho = from ? `${from.engine}（${from.roleName}）` : "一位同事";

    emit({ kind: "status", from: staff.id, text: "收到老板转来的密报，正在处理…" });

    const prompt = [
      `老板把${fromWho}写的一条密报转给你了，原文如下：`,
      "",
      "「" + memo.text + "」",
      "",
      "这件事从现在起进入公司流程，由你接手。按你的岗位职责给出回应：",
      "该行动的写清怎么做，该提醒的写清风险。不要复述原文。",
      PROTOCOL,
    ].join("\n");

    const raw = await hire(staff, prompt);
    const r = split(raw);

    if (r.reply) emit({ kind: "group", from: staff.id, text: r.reply });
    for (const d of r.dms) {
      const to = staffOf(d.to);
      if (to && to.id !== staff.id) emit({ kind: "dm", from: staff.id, to: to.id, text: d.text });
    }
    if (r.secret) emit({ kind: "secret", from: staff.id, text: r.secret });

    emit({ kind: "system", text: "这单办完了。" });
  } catch (e) {
    emit({ kind: "system", text: "出事了：" + e.message });
  } finally {
    busy = false;
    broadcast({ type: "busy", busy: false });
  }
}

async function runJob(task) {
  if (busy) {
    emit({ kind: "system", text: "手上还有活在办，等这件办完。" });
    return;
  }
  busy = true;
  broadcast({ type: "busy", busy: true });

  try {
    emit({ kind: "group", from: "boss", text: task });

    const vars = { task, protocol: PROTOCOL };

    for (const step of WORKFLOW.steps || []) {
      const s = byRole(step.role);
      if (!s) continue;
      if (step.needs && step.needs.some((k) => !vars[k])) continue;

      const role = ROLES.find((r) => r.id === step.role);
      if (!role) continue;

      emit({ kind: "status", from: s.id, text: `开始（${role.name}）…` });

      const raw = await hire(s, render(role.body, vars));
      const r = split(raw);

      if (r.reply) {
        emit({ kind: "group", from: s.id, text: r.reply });
        if (step.output) vars[step.output] = r.reply;
      }
      for (const d of r.dms) {
        const to = staffOf(d.to);
        if (to && to.id !== s.id) emit({ kind: "dm", from: s.id, to: to.id, text: d.text });
      }
      if (r.secret) emit({ kind: "secret", from: s.id, text: r.secret });
    }

    if (vars.draft) {
      const verdict = vars.verdict ? vars.verdict.trim() : "";
      const pass = /^通过/.test(verdict);
      const writer = byRole("writer");
      const file = writeDeliverable(
        task,
        vars.draft,
        writer ? `${writer.engine}（${writer.roleName}）` : "未知"
      );
      state.deliveries.unshift({
        id: ++state.seq,
        title: task.slice(0, 40),
        body: vars.draft,
        file,
        by: writer ? writer.id : null,
        verdict: verdict ? (pass ? "pass" : "back") : "pending",
        reason: verdict && !pass ? verdict : "",
        at: Date.now(),
      });
      state.deliveries = state.deliveries.slice(0, 50);
      save();
      broadcast({ type: "deliveries" });
    }

    emit({ kind: "system", text: "这单办完了。" });
  } catch (e) {
    emit({ kind: "system", text: "出事了：" + e.message });
  } finally {
    busy = false;
    broadcast({ type: "busy", busy: false });
  }
}

// ---------- HTTP ----------
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function body(req) {
  return new Promise((resolve) => {
    let d = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(d || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // 只认自己这个页面发来的写请求。
  // 否则你随便打开一个网页，它就能偷偷往 localhost:4173 派活、让员工写你的文件。
  if (req.method === "POST") {
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === req.headers.host;
      } catch {}
      if (!ok) return json(res, 403, { error: "跨站请求已拒绝" });
    }
  }

  if (p === "/" || p === "/index.html") {
    const html = readFileSync(join(HERE, "public", "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (p === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (p === "/api/state") {
    return json(res, 200, {
      staff: staffView(),
      messages: state.messages.slice(-200),
      deliveries: state.deliveries,
      engines: ENGINES.map((e) => ({
        ...e,
        // API 型靠环境变量里有没有 key 来判断能不能招；本地模型不设 keyEnv，永远可用
        ready: e.type === "api" ? (e.keyEnv ? !!process.env[e.keyEnv] : true) : !!e.ready,
      })),
      roles: ROLES.map((r) => ({ id: r.id, name: r.name, duty: r.duty })),
      workflow: WORKFLOW.steps || [],
      dshReady: !!DSH,
      busy,
    });
  }

  if (p === "/api/hire" && req.method === "POST") {
    const b = await body(req);
    const eng = ENGINES.find((e) => e.id === b.engine);
    const role = ROLES.find((r) => r.id === b.role);
    if (!eng || !role) return json(res, 400, { error: "没这个人或这个岗位" });
    if (state.staff.some((s) => s.role === role.id && !s.gone)) {
      return json(res, 400, { error: `${role.name}这个岗位已经有人了` });
    }
    state.staff.push({
      id: `${eng.id}-${role.id}`,
      engine: eng.id,
      engineId: eng.id,
      role: role.id,
      roleName: role.name,
      sessionId: null,
      hiredAt: Date.now(),
    });
    save();
    emit({ kind: "system", text: `${eng.name} 入职，岗位：${role.name}` });
    return json(res, 200, { staff: staffView() });
  }

  if (p === "/api/fire" && req.method === "POST") {
    const b = await body(req);
    const s = state.staff.find((x) => x.id === b.id);
    if (!s) return json(res, 404, { error: "没这个人" });
    if (s.gone) return json(res, 400, { error: "这个人已经离职了" });

    // 不删记录，只标记。历史消息里还要能显示「这是谁说的」，
    // 直接删掉的话，旧对话里就会冒出一堆「某人（）」。
    s.gone = true;
    s.leftAt = Date.now();
    save();

    const e = engineOf(s.engine);
    emit({ kind: "system", text: `${e ? e.name : s.engine}（${s.roleName}）离职了` });
    return json(res, 200, { staff: staffView() });
  }

  if (p === "/api/task" && req.method === "POST") {
    const b = await body(req);
    const t = (b.text || "").trim();
    if (!t) return json(res, 400, { error: "空任务" });
    if (!state.staff.length) return json(res, 400, { error: "公司里没人，先招人" });
    runJob(t);
    return json(res, 200, { ok: true });
  }

  if (p === "/api/relay" && req.method === "POST") {
    const b = await body(req);
    if (busy) return json(res, 409, { error: "员工手上还有活，等它空下来再转" });

    const msg = state.messages.find((m) => m.id === b.msgId);
    if (!msg) return json(res, 404, { error: "没这条消息" });
    if (msg.kind !== "secret") return json(res, 400, { error: "只有密报可以转达" });
    if (msg.relayedTo) return json(res, 409, { error: "这条密报已经转出去了" });

    const to = state.staff.find((s) => s.id === b.to);
    if (!to) return json(res, 404, { error: "没这个人" });
    if (to.id === msg.from) return json(res, 400, { error: "不能转回给写这条密报的人" });

    msg.relayedTo = to.id;
    save();
    broadcast({ type: "message", msg });
    emit({ kind: "system", text: `老板把这条密报交给了 ${to.engine}（${to.roleName}）` });
    relayMemo(msg, to);
    return json(res, 200, { ok: true });
  }

  res.writeHead(404);
  res.end("not found");
});

ensureDirs();
loadState();
syncRosterFile();

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`\n  AI 工作室已启动： http://${shown}:${PORT}\n`);
  console.log(`  岗位 ${ROLES.length} 个：${ROLES.map((r) => r.name).join("、")}`);
  console.log(`  流程 ${(WORKFLOW.steps || []).length} 步`);
  console.log(`  员工工作区：${WORK_DIR}`);
  console.log(`  监听 ${HOST === "0.0.0.0" ? "所有网卡（同一网络的人都能访问）" : "仅本机"}\n`);
  console.log(DSH ? `  DSH: ${DSH}\n` : "  警告：没找到 DSH，员工没法干活。请设置环境变量 DSH_BIN\n");
  if (process.platform === "win32" && !process.env.NO_OPEN) exec(`start "" http://localhost:${PORT}`);
});
