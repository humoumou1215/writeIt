import { describe, expect, it } from "vitest";
import { buildCompleteNotification, buildFailedNotification, buildStartNotification, sendOpenClawMessage } from "../src/notifier.js";

const context = {
  traceId: "pis_test",
  mode: "RESUME" as const,
  sessionId: "S1",
  cwd: "/repo",
  requested: { prompt: "检查 \"$() && ;", model: "openai/gpt-5.6", thinkingLevel: "high" as const },
  effective: { model: "openai/gpt-5.6", thinkingLevel: "high" as const, cwd: "/repo" },
  modelSource: "explicit" as const,
  thinkingSource: "explicit" as const,
  durationMs: 1234,
  response: "完成了架构检查",
  promptPreviewChars: 500,
  responsePreviewChars: 1200,
};

describe("pi_session notifications", () => {
  it("keeps START notification compact, translated and puts mode in the title", () => {
    const text = buildStartNotification(context);
    expect(text).toContain("🤖 Pi 会话开始 · 恢复");
    expect(text).toContain("会话：S1");
    expect(text).toContain("工作目录：/repo");
    expect(text).toContain("模型：openai/gpt-5.6 · 思考：high");
    expect(text).not.toContain("Trace:");
    expect(text).not.toContain("Mode:");
    expect(text).not.toContain("Model Source:");
    expect(text).not.toContain("Thinking Source:");
    expect(text).toContain("提示词：");
    expect(text).toContain("$()");
  });

  it("keeps COMPLETE aligned with START without repeating CWD", () => {
    const text = buildCompleteNotification(context);
    expect(text).toContain("✅ Pi 会话完成 · 恢复");
    expect(text).toContain("会话：S1");
    expect(text).toContain("模型：openai/gpt-5.6 · 思考：high");
    expect(text).not.toContain("Trace:");
    expect(text).not.toContain("工作目录：");
    expect(text).toContain("耗时：1.2 秒");
    expect(text).toContain("响应：完成了架构检查");
  });

  it("uses the translated fallback when a response is unavailable", () => {
    const { response: _response, ...withoutResponse } = context;
    const text = buildCompleteNotification(withoutResponse);
    expect(text).toContain("响应：未解析");
    expect(text).not.toContain("unresolved");
  });

  it("rejects an unsafe direct Feishu target without spawning a process", async () => {
    const result = await sendOpenClawMessage({
      enabled: true,
      provider: "openclaw",
      channel: "feishu",
      target: "ou_valid",
      account: "default",
      command: "does-not-run",
      timeoutMs: 1000,
    }, "hello", { target: "not-a-feishu-target" });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("explicit Feishu");
  });

  it("shows unresolved effective configuration on failure", () => {
    const { effective: _effective, ...failureContext } = context;
    const text = buildFailedNotification({
      ...failureContext,
      errorCode: "MODEL_NOT_AVAILABLE",
      errorMessage: "model foo/bar was not found",
    });
    expect(text).toContain("实际模型：未解析");
    expect(text).toContain("错误：MODEL_NOT_AVAILABLE");
  });
});
