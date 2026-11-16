# 参与贡献

中文为主。一句话版：**最受欢迎的贡献是加一个岗位，不需要写代码。**

---

## 最快的贡献：加一个岗位

一个岗位就是一个 markdown 文件。拿 `company/roles/writer.md` 当模板：

```markdown
---
id: designer
name: 美工
duty: 出图、排版建议，不负责文字
---

你是这家公司的美工。老板的原话：
「{{task}}」
{{#if plan}}
秘书给你的指令：
「{{plan}}」
{{/if}}

交付要求：说清用什么视觉手段、为什么，给出可以直接执行的描述。
{{protocol}}
```

然后在 `company/workflow.json` 的 `steps` 里插一行：

```json
{ "role": "designer", "output": "design", "needs": ["plan"] }
```

搞定。不用碰 `server.mjs`。

**变量约定**：`{{task}}` 是老板原话，`{{protocol}}` 是三层输出协议，
其他 `{{名字}}` 来自前面步骤的 `output`。`{{#if 变量}}…{{/if}}` 可以做条件段落。

---

## 跑起来

```bash
node server.mjs          # 需要本机装好 DSH，并且账号可用
```

开发者技巧：用环境变量起第二个实例，不污染你自己的数据：

```bash
PORT=4175 DATA_DIR=/tmp/a WORK_DIR=/tmp/b NO_OPEN=1 node server.mjs
```

这样可以直接看「一个完全没数据的陌生人打开是什么样」。

---

## 项目结构

```
server.mjs          引擎：读配置、叫员工、路由消息
public/index.html   界面，单文件无构建
company/            公司定义，进仓库
  roles/*.md        岗位
  workflow.json     流程
  engines.json      可雇引擎
data/               运行时数据，不进仓库
workspace/          员工工作区，不进仓库
```

---

## 提交前请自查

1. `node --check server.mjs`
2. 前端脚本也过一遍语法：
   ```bash
   node -e "const fs=require('fs');const m=fs.readFileSync('public/index.html','utf8').match(/<script>([\s\S]*?)<\/script>/);fs.writeFileSync('_c.mjs',m[1])" && node --check _c.mjs && rm _c.mjs
   ```
3. 用空目录起一个实例，从头走一遍「招人 → 派活 → 产出」
4. **不要提交** `data/`、`workspace/`、任何 `.key` 或真实 API key

---

## 提交信息

```
feat: 新功能
fix: 修 bug
docs: 只改文档
chore: 杂项
refactor: 重构不改行为
```

---

## 关于安全

改动涉及文件路径、进程调用、密钥处理时，请先读 `SECURITY.md` 里的边界说明。
