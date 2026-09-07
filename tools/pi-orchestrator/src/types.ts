export type PiSessionMode = "NEW" | "RESUME";
export type ConfigSource = "explicit" | "restored" | "default";
export type NotificationStatus = "sent" | "failed";

export interface PiSessionInput {
  prompt: string;
  resume?: string;
  model?: string;
  thinkingLevel?: PiThinkingLevel;
  cwd?: string;
}

export interface EffectiveConfiguration {
  model: string;
  thinkingLevel: PiThinkingLevel;
  cwd: string;
}

export interface RequestedConfiguration {
  model?: string;
  thinkingLevel?: PiThinkingLevel;
  cwd?: string;
}

export interface PiSessionDetails {
  traceId: string;
  sessionId: string;
  sessionFile?: string;
  mode: PiSessionMode;
  requested: RequestedConfiguration;
  effective?: EffectiveConfiguration;
  effectiveAtStart?: EffectiveConfiguration;
  effectiveAtEnd?: EffectiveConfiguration;
  modelSource?: ConfigSource;
  thinkingSource?: ConfigSource;
  override: {
    model: boolean;
    thinkingLevel: boolean;
  };
  durationMs: number;
  notifications: {
    start: NotificationStatus;
    end: NotificationStatus;
  };
  status: "completed" | "failed";
  errorCode?: string;
}

export interface NotificationConfig {
  enabled: boolean;
  provider: "openclaw";
  channel: "feishu";
  target: string;
  account: string;
  command: string;
  timeoutMs: number;
}

export interface PiSessionToolConfig {
  agentDir?: string;
  notifications: NotificationConfig;
  promptPreviewChars: number;
  responsePreviewChars: number;
  maxDepth: number;
}

export interface NotificationResult {
  status: NotificationStatus;
  response?: unknown;
  error?: string;
}

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type PiThinkingLevel = (typeof THINKING_LEVELS)[number];
