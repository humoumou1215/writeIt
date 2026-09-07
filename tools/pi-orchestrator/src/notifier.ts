import { spawn } from "node:child_process";
import type {
  EffectiveConfiguration,
  NotificationConfig,
  NotificationResult,
  PiSessionInput,
  PiSessionMode,
} from "./types.js";

export interface NotificationContext {
  traceId: string;
  mode: PiSessionMode;
  sessionId: string;
  cwd: string;
  requested: PiSessionInput;
  effective?: EffectiveConfiguration;
  effectiveAtStart?: EffectiveConfiguration;
  durationMs?: number;
  response?: string;
  errorCode?: string;
  errorMessage?: string;
  promptPreviewChars: number;
  responsePreviewChars: number;
}

function preview(value: string | undefined, maxChars: number): string {
  if (!value) return "未解析";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function modeLabel(mode: PiSessionMode): string {
  return mode === "NEW" ? "新建" : "恢复";
}

function runtimeLine(context: NotificationContext): string {
  return `模型：${context.effective?.model ?? "未解析"} · 思考：${context.effective?.thinkingLevel ?? "未解析"}`;
}

export function buildStartNotification(context: NotificationContext): string {
  return [
    `🤖 Pi 会话开始 · ${modeLabel(context.mode)}`,
    "",
    `会话：${context.sessionId}`,
    `工作目录：${context.effective?.cwd ?? context.cwd}`,
    runtimeLine(context),
    "",
    `提示词：${preview(context.requested.prompt, context.promptPreviewChars)}`,
  ].join("\n");
}

export function buildCompleteNotification(context: NotificationContext): string {
  return [
    `✅ Pi 会话完成 · ${modeLabel(context.mode)}`,
    "",
    `会话：${context.sessionId}`,
    runtimeLine(context),
    `耗时：${((context.durationMs ?? 0) / 1_000).toFixed(1)} 秒`,
    ...(context.effectiveAtStart && context.effective && (
      context.effectiveAtStart.model !== context.effective.model ||
      context.effectiveAtStart.thinkingLevel !== context.effective.thinkingLevel
    ) ? [
      `运行期间配置变化：${context.effectiveAtStart.model}/${context.effectiveAtStart.thinkingLevel} → ${context.effective.model}/${context.effective.thinkingLevel}`,
    ] : []),
    "",
    `响应：${preview(context.response, context.responsePreviewChars)}`,
  ].join("\n");
}

export function buildFailedNotification(context: NotificationContext): string {
  return [
    `❌ Pi 会话失败 · ${modeLabel(context.mode)}`,
    "",
    `会话：${context.sessionId}`,
    `工作目录：${context.effective?.cwd ?? context.cwd}`,
    `请求模型：${context.requested.model ?? "默认"}`,
    `请求思考：${context.requested.thinkingLevel ?? "默认"}`,
    `实际模型：${context.effective?.model ?? "未解析"}`,
    `实际思考：${context.effective?.thinkingLevel ?? "未解析"}`,
    `耗时：${((context.durationMs ?? 0) / 1_000).toFixed(1)} 秒`,
    "",
    `错误：${context.errorCode ?? "内部错误"}`,
    context.errorMessage ?? "未知错误",
  ].join("\n");
}

function runOpenClaw(
  config: NotificationConfig,
  message: string,
  target = config.target,
  account = config.account,
  respectEnabled = true,
): Promise<NotificationResult> {
  if (respectEnabled && !config.enabled) return Promise.resolve({ status: "failed", error: "notifications disabled" });
  if (!target) return Promise.resolve({ status: "failed", error: "Feishu target is not configured" });

  return new Promise((resolve) => {
    const child = spawn(config.command, [
      "message",
      "send",
      "--channel",
      config.channel,
      "--account",
      account,
      "--target",
      target,
      "--message",
      message,
      "--json",
    ], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill("SIGTERM");
      resolve({ status: "failed", error: `OpenClaw notification timed out after ${config.timeoutMs}ms` });
    }, config.timeoutMs);
    timer.unref();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ status: "failed", error: error.message });
    });
    child.once("exit", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ status: "failed", error: stderr.trim() || `OpenClaw exited with ${code ?? signal ?? "unknown status"}` });
        return;
      }
      try {
        const response = JSON.parse(stdout) as Record<string, unknown>;
        const delivered = response.ok === true || response.messageId !== undefined || response.payload !== undefined;
        resolve(delivered
          ? { status: "sent", response }
          : { status: "failed", response, error: "OpenClaw did not return a delivery acknowledgement" });
      } catch (error) {
        resolve({ status: "failed", error: error instanceof Error ? error.message : "Invalid OpenClaw JSON response" });
      }
    });
  });
}

export function safeNotify(config: NotificationConfig, message: string): Promise<NotificationResult> {
  return runOpenClaw(config, message).catch((error: unknown) => ({
    status: "failed" as const,
    error: error instanceof Error ? error.message : String(error),
  }));
}

export interface DirectFeishuMessageResult extends NotificationResult {
  target: string;
  account: string;
}

export function sendOpenClawMessage(
  config: NotificationConfig,
  message: string,
  options: { target?: string; account?: string } = {},
): Promise<DirectFeishuMessageResult> {
  const target = options.target ?? config.target;
  const account = options.account ?? config.account;
  if (!/^ou_[A-Za-z0-9]+$/.test(target) && !/^oc_[A-Za-z0-9]+$/.test(target)) {
    return Promise.resolve({
      status: "failed",
      target,
      account,
      error: "target must be an explicit Feishu ou_ or oc_ id",
    });
  }
  return runOpenClaw(config, message, target, account, false)
    .then((result) => ({ ...result, target, account }))
    .catch((error: unknown) => ({
      status: "failed" as const,
      target,
      account,
      error: error instanceof Error ? error.message : String(error),
    }));
}

export function previewText(value: string | undefined, maxChars: number): string {
  return preview(value, maxChars);
}
