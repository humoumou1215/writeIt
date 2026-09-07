# `pi_session` Tool

这是一个 Pi Extension Tool，不再负责 WriteIt Task 调度、STATUS gate、Git 审计或后台任务编排。

它提供两个独立 Tool：

- `pi_session`：创建/恢复真实、独立、持久化的 Pi Session。
- `feishu_message`：直接通过本机 OpenClaw Feishu outbound 发送消息，不创建 Pi Session、不调用另一个 LLM。

## 安装

```bash
cd tools/pi-orchestrator
npm ci
npm run check
npm run build

mkdir -p ~/.pi/agent/extensions
ln -sfn "$PWD/dist/src" ~/.pi/agent/extensions/pi-session
```

重启 Pi，或执行：

```text
/reload
```

配置文件：

```bash
mkdir -p ~/.config/pi-session-tool
cp config.example.json ~/.config/pi-session-tool/config.json
```

配置中的 `target` 改为明确的飞书 `ou_...` 或 `oc_...` ID。也可以通过 `PI_SESSION_TOOL_CONFIG` 指定配置路径。

## Tool Schema

```json
{
  "prompt": "检查当前项目",
  "resume": "可选的真实 sessionId",
  "model": "provider/modelId",
  "thinkingLevel": "off | minimal | low | medium | high | xhigh | max",
  "cwd": "/absolute/path"
}
```

- 不提供 `resume`：创建新的 persistent Session。
- 提供 `resume`：恢复真实 Session history、Model state、Thinking state、Compaction 和 Tool history。
- `model` 必须是精确的 `provider/modelId`，不做模糊匹配。
- `cwd` 对 NEW 生效；RESUME 时必须与 Session 原 cwd 相同，否则返回 `INVALID_RESUME_CWD`。
- `/prompt`、Prompt Template、Skill Slash Command、Extension Command 原样交给 `session.prompt(prompt, { expandPromptTemplates: true })`，Tool 不自行解析。

示例：

```json
{
  "prompt": "分析当前项目的架构",
  "model": "openai/gpt-5.6",
  "thinkingLevel": "high",
  "cwd": "/Users/me/project"
}
```

继续同一个 Session：

```json
{
  "resume": "01ABC...",
  "prompt": "继续刚才的分析",
  "model": "openai/gpt-5.6",
  "thinkingLevel": "xhigh"
}
```

显式覆盖通过 `session.setModel()` / `session.setThinkingLevel()` 写入该 Session。下一次不再指定时，会继承 Session 当前状态。

## 返回值

成功时 Tool content 是本轮最终 Assistant Response。Details 包含：

- `traceId`
- `sessionId` / `sessionFile`
- `mode: NEW | RESUME`
- requested / effective configuration
- `effectiveAtStart` / `effectiveAtEnd`
- Model / Thinking 是否显式覆盖
- `durationMs`
- START / COMPLETE 通知结果
- `status: completed`

失败时返回 `isError: true`，并使用明确错误码，例如：

```text
MODEL_NOT_AVAILABLE
UNSUPPORTED_THINKING_LEVEL
SESSION_NOT_FOUND
AMBIGUOUS_SESSION_ID
SESSION_OPEN_FAILED
INVALID_RESUME_CWD
PI_AGENT_ERROR
NO_ASSISTANT_RESPONSE
PI_SESSION_MAX_DEPTH_EXCEEDED
INVALID_INPUT
```

## `feishu_message`

直接发送消息：

```json
{
  "message": "部署已完成"
}
```

默认发送到 `~/.config/pi-session-tool/config.json` 中的 `notifications.target`。如确实需要显式指定目标：

```json
{
  "message": "请查看构建结果",
  "target": "ou_142dd0633f433d65ced4040f4c486516",
  "account": "default"
}
```

`target` 只接受明确的 `ou_...` 或 `oc_...` ID。调用使用 `spawn(..., { shell: false })`，消息内容中的 Shell 字符不会被执行。成功时返回 Feishu message ID 和 OpenClaw response/receipt；失败时返回 `FEISHU_SEND_FAILED`。

该 Tool 不受 `notifications.enabled` 的 observability 开关影响；只要目标和 OpenClaw 配置有效，就直接发送。

## `pi_session` 飞书通知

每次 `pi_session` 调用恰好尝试：

```text
1 × START
1 × COMPLETE 或 FAILED
```

通知通过本地 OpenClaw 的参数数组调用，`shell: false`，Prompt 和 Response 不会被拼接进 Shell 命令。

START / COMPLETE / FAILED 通知采用紧凑中文格式：

```text
🤖 Pi 会话开始 · 新建

会话：01ABC...
工作目录：/Users/me/project
模型：openai-codex/gpt-5.6-luna · 思考：max

提示词：检查当前项目
```

```text
✅ Pi 会话完成 · 新建

会话：01ABC...
模型：openai-codex/gpt-5.6-luna · 思考：max
耗时：20.1 秒

响应：已完成检查
```

完成通知不重复显示工作目录。Model / Thinking 的来源（显式传入、恢复或默认）不放入通知正文，但仍保留在返回的 Details 中供审计和排查。缺少值时显示“未解析”。
通知失败只记录在 Details，不改变 Pi Session 的成功或失败结果。

## 并发与递归

- 同一个 Resume Session 使用 per-session mutex，锁覆盖打开、Runtime 覆盖、Prompt、等待 idle、读取结果和 dispose。
- 不同 Session 可以并行。
- 使用 `AsyncLocalStorage` 追踪嵌套深度，并读取 `PI_SESSION_TOOL_DEPTH` 作为跨进程初始深度；默认 `maxDepth: 2`。
- 子 Session 继承正常 Pi Environment：cwd、AGENTS.md、`.pi/`、全局设置、Extensions、Skills、Prompt Templates 和认证配置。
- 不会自动创建大量 Session；每次 `pi_session` 调用最多创建或恢复一个 Session。

## 本地配置

`config.example.json`：

```json
{
  "agentDir": "~/.pi/agent",
  "notifications": {
    "enabled": true,
    "provider": "openclaw",
    "channel": "feishu",
    "target": "ou_xxx",
    "account": "default",
    "command": "~/.npm-global/bin/openclaw",
    "timeoutMs": 10000
  },
  "promptPreviewChars": 500,
  "responsePreviewChars": 1200,
  "maxDepth": 2
}
```

没有配置文件时，Tool 仍然可以运行，但 OpenClaw 通知会标记为 `failed`；通知故障不会改变任务结果。
