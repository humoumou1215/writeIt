import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { NotificationConfig, PiSessionToolConfig } from "./types.js";

export const DEFAULT_CONFIG_PATH = resolve(homedir(), ".config/pi-session-tool/config.json");

const DEFAULTS: PiSessionToolConfig = {
  notifications: {
    enabled: true,
    provider: "openclaw",
    channel: "feishu",
    target: process.env.PI_SESSION_FEISHU_TARGET ?? "",
    account: process.env.PI_SESSION_FEISHU_ACCOUNT ?? "default",
    command: process.env.PI_SESSION_OPENCLAW ?? "openclaw",
    timeoutMs: 10_000,
  },
  promptPreviewChars: 500,
  responsePreviewChars: 1_200,
  maxDepth: 2,
};

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return value;
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function notificationConfig(raw: Partial<NotificationConfig> | undefined): NotificationConfig {
  return {
    enabled: raw?.enabled ?? DEFAULTS.notifications.enabled,
    provider: "openclaw",
    channel: "feishu",
    target: raw?.target ?? DEFAULTS.notifications.target,
    account: raw?.account ?? DEFAULTS.notifications.account,
    command: raw?.command ? expandHome(raw.command) : DEFAULTS.notifications.command,
    timeoutMs: integer(raw?.timeoutMs, DEFAULTS.notifications.timeoutMs, 1_000, 120_000),
  };
}

export async function loadConfig(): Promise<{ config: PiSessionToolConfig; error?: string }> {
  const configPath = expandHome(process.env.PI_SESSION_TOOL_CONFIG ?? DEFAULT_CONFIG_PATH);
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as Partial<PiSessionToolConfig>;
    const agentDir = raw.agentDir && isAbsolute(expandHome(raw.agentDir))
      ? resolve(expandHome(raw.agentDir))
      : undefined;
    return {
      config: {
        ...(agentDir ? { agentDir } : {}),
        notifications: notificationConfig(raw.notifications),
        promptPreviewChars: integer(raw.promptPreviewChars, DEFAULTS.promptPreviewChars, 50, 10_000),
        responsePreviewChars: integer(raw.responsePreviewChars, DEFAULTS.responsePreviewChars, 50, 20_000),
        maxDepth: integer(raw.maxDepth, DEFAULTS.maxDepth, 0, 10),
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: DEFAULTS };
    return { config: DEFAULTS, error: error instanceof Error ? error.message : String(error) };
  }
}
