import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { loadConfig } from "./config.js";
import { asPiSessionError, PiSessionError } from "./errors.js";
import {
  buildCompleteNotification,
  buildFailedNotification,
  buildStartNotification,
  safeNotify,
  type NotificationContext,
} from "./notifier.js";
import type {
  ConfigSource,
  EffectiveConfiguration,
  PiSessionDetails,
  PiSessionInput,
  PiSessionMode,
  PiSessionToolConfig,
  PiThinkingLevel,
} from "./types.js";

const depthStorage = new AsyncLocalStorage<number>();
const sessionLocks = new Map<string, Promise<void>>();

function traceId(): string {
  return `pis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function requestedConfig(input: PiSessionInput) {
  return {
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
  };
}

function requestedModelParts(value: string): { provider: string; modelId: string } {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1 || value.includes("//")) {
    throw new PiSessionError("MODEL_NOT_AVAILABLE", `model must use exact provider/modelId form: ${value}`);
  }
  return { provider: value.slice(0, separator), modelId: value.slice(separator + 1) };
}

function exactModel(runtime: ModelRuntime, value: string) {
  const { provider, modelId } = requestedModelParts(value);
  const model = runtime.getModel(provider, modelId);
  if (!model) throw new PiSessionError("MODEL_NOT_AVAILABLE", `model ${value} is not registered`);
  return model;
}

function normalizeCwd(value: string, parentCwd: string): string {
  return resolve(parentCwd, value);
}

async function findSession(resume: string) {
  const sessions = await SessionManager.listAll();
  const exact = sessions.filter((item) => item.id === resume);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new PiSessionError("AMBIGUOUS_SESSION_ID", `session id ${resume} is ambiguous`);
  const prefix = sessions.filter((item) => item.id.startsWith(resume));
  if (prefix.length === 0) throw new PiSessionError("SESSION_NOT_FOUND", `session ${resume} was not found`);
  if (prefix.length > 1) throw new PiSessionError("AMBIGUOUS_SESSION_ID", `session prefix ${resume} matches ${prefix.length} sessions`);
  return prefix[0]!;
}

async function withSessionLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveRelease) => { release = resolveRelease; });
  sessionLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (sessionLocks.get(key) === current) sessionLocks.delete(key);
  }
}

function effectiveConfiguration(session: AgentSession, manager: SessionManager): EffectiveConfiguration {
  if (!session.model) throw new PiSessionError("PI_AGENT_ERROR", "Pi did not resolve an effective model");
  return {
    model: `${session.model.provider}/${session.model.id}`,
    thinkingLevel: session.thinkingLevel as PiThinkingLevel,
    cwd: manager.getCwd(),
  };
}

function sourceFor(mode: PiSessionMode, explicit: boolean, fallback: boolean): ConfigSource {
  if (explicit) return "explicit";
  if (fallback) return "default";
  return mode === "RESUME" ? "restored" : "default";
}

function textFromMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || (message as { role?: string }).role !== "assistant") return undefined;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((item): item is { type: "text"; text: string } =>
      Boolean(item && typeof item === "object" && (item as { type?: string }).type === "text" && typeof (item as { text?: unknown }).text === "string"),
    )
    .map((item) => item.text)
    .join("\n")
    .trim();
  return text || undefined;
}

function finalAssistantResponse(session: AgentSession, messageCountBefore: number): string {
  const messages = session.messages.slice(messageCountBefore);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: string; errorMessage?: string };
    const text = textFromMessage(message);
    if (text) return text;
    if (message.role === "assistant" && message.errorMessage) {
      throw new PiSessionError("PI_AGENT_ERROR", message.errorMessage);
    }
  }
  throw new PiSessionError("NO_ASSISTANT_RESPONSE", "the session produced no final assistant response");
}

function notificationContext(
  trace: string,
  mode: PiSessionMode,
  input: PiSessionInput,
  sessionId: string,
  cwd: string,
  effective: EffectiveConfiguration | undefined,
  config: PiSessionToolConfig,
  durationMs?: number,
  effectiveAtStart?: EffectiveConfiguration,
  response?: string,
): NotificationContext {
  return {
    traceId: trace,
    mode,
    sessionId,
    cwd,
    requested: input,
    ...(effective ? { effective } : {}),
    ...(effectiveAtStart ? { effectiveAtStart } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(response !== undefined ? { response } : {}),
    promptPreviewChars: config.promptPreviewChars,
    responsePreviewChars: config.responsePreviewChars,
  };
}

function resultDetails(
  trace: string,
  mode: PiSessionMode,
  input: PiSessionInput,
  session: AgentSession | undefined,
  manager: SessionManager | undefined,
  effectiveStart: EffectiveConfiguration | undefined,
  effectiveEnd: EffectiveConfiguration | undefined,
  modelSource: ConfigSource | undefined,
  thinkingSource: ConfigSource | undefined,
  durationMs: number,
  startStatus: "sent" | "failed",
  endStatus: "sent" | "failed",
  status: "completed" | "failed",
  errorCode?: string,
): PiSessionDetails {
  const sessionFile = session?.sessionFile ?? manager?.getSessionFile();
  const effective = effectiveEnd ?? effectiveStart;
  return {
    traceId: trace,
    sessionId: session?.sessionId ?? manager?.getSessionId() ?? "unresolved",
    ...(sessionFile ? { sessionFile } : {}),
    mode,
    requested: requestedConfig(input),
    ...(effective ? { effective } : {}),
    ...(effectiveStart ? { effectiveAtStart: effectiveStart } : {}),
    ...(effectiveEnd ? { effectiveAtEnd: effectiveEnd } : {}),
    ...(modelSource ? { modelSource } : {}),
    ...(thinkingSource ? { thinkingSource } : {}),
    override: {
      model: input.model !== undefined,
      thinkingLevel: input.thinkingLevel !== undefined,
    },
    durationMs,
    notifications: { start: startStatus, end: endStatus },
    status,
    ...(errorCode ? { errorCode } : {}),
  };
}

async function applyRuntimeConfiguration(
  session: AgentSession,
  manager: SessionManager,
  input: PiSessionInput,
  explicitModel: ReturnType<ModelRuntime["getModel"]>,
  restoredModelFallback: boolean,
): Promise<{ effective: EffectiveConfiguration; modelSource: ConfigSource; thinkingSource: ConfigSource }> {
  const mode: PiSessionMode = input.resume ? "RESUME" : "NEW";

  if (input.model) {
    if (!explicitModel) throw new PiSessionError("MODEL_NOT_AVAILABLE", `model ${input.model} is not available`);
    if (input.thinkingLevel && !getSupportedThinkingLevels(explicitModel).includes(input.thinkingLevel as never)) {
      throw new PiSessionError("UNSUPPORTED_THINKING_LEVEL", `${input.model} does not support ${input.thinkingLevel}`);
    }
    try {
      await session.setModel(explicitModel);
    } catch (error) {
      throw new PiSessionError("MODEL_OVERRIDE_FAILED", `could not switch to ${input.model}`, error);
    }
  }

  if (input.thinkingLevel) {
    const available = session.getAvailableThinkingLevels() as readonly string[];
    if (!available.includes(input.thinkingLevel)) {
      throw new PiSessionError("UNSUPPORTED_THINKING_LEVEL", `${effectiveConfiguration(session, manager).model} does not support ${input.thinkingLevel}`);
    }
    session.setThinkingLevel(input.thinkingLevel);
  }

  const effective = effectiveConfiguration(session, manager);
  return {
    effective,
    modelSource: sourceFor(mode, Boolean(input.model), restoredModelFallback),
    thinkingSource: sourceFor(mode, Boolean(input.thinkingLevel), restoredModelFallback),
  };
}

export const piSessionTool: ToolDefinition = defineTool({
  name: "pi_session",
  label: "Pi Session",
  description: "Create or resume an independent persistent Pi Session, optionally override its exact Model and Thinking Level, execute the original prompt, and return the final assistant response.",
  promptSnippet: "Start or resume a persistent Pi Session",
  promptGuidelines: [
    "Use pi_session when work should happen in an independent persistent Pi Session.",
    "Pass Model and Thinking Level as structured arguments, not inside the prompt.",
    "Use resume with the returned sessionId to continue the same real Session; do not simulate resume by copying history into a prompt.",
  ],
  parameters: Type.Object({
    prompt: Type.String({ description: "Original Pi prompt. Native slash commands are passed through unchanged." }),
    resume: Type.Optional(Type.String({ description: "Existing Pi session id or unique id prefix. Omit to create a new persistent session." })),
    model: Type.Optional(Type.String({ description: "Exact provider/modelId, for example openai/gpt-5.6." })),
    thinkingLevel: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)),
    cwd: Type.Optional(Type.String({ description: "Working directory for NEW. RESUME must match the stored Session cwd." })),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const input = params as PiSessionInput;
    const startedAt = Date.now();
    const trace = traceId();
    const mode: PiSessionMode = input.resume ? "RESUME" : "NEW";
    const loaded = await loadConfig();
    const config = loaded.config;
    let session: AgentSession | undefined;
    let manager: SessionManager | undefined;
    let effectiveStart: EffectiveConfiguration | undefined;
    let effectiveEnd: EffectiveConfiguration | undefined;
    let modelSource: ConfigSource | undefined;
    let thinkingSource: ConfigSource | undefined;
    let startStatus: "sent" | "failed" = "failed";
    let endStatus: "sent" | "failed" = "failed";
    let startAttempted = false;
    let resumeInfo: Awaited<ReturnType<typeof findSession>> | undefined;
    let notificationCwd = input.cwd ? normalizeCwd(input.cwd, ctx.cwd) : ctx.cwd;
    let notificationSessionId = input.resume ?? "unresolved";

    const notifyStart = async () => {
      if (startAttempted) return;
      startAttempted = true;
      const notification = await safeNotify(
        config.notifications,
        buildStartNotification(notificationContext(
          trace,
          mode,
          input,
          session?.sessionId ?? notificationSessionId,
          manager?.getCwd() ?? notificationCwd,
          effectiveStart,
          config,
        )),
      );
      startStatus = notification.status;
    };

    try {
      if (!input.prompt.trim()) throw new PiSessionError("INVALID_INPUT", "prompt must not be empty");
      const environmentDepth = Number.parseInt(process.env.PI_SESSION_TOOL_DEPTH ?? "0", 10);
      const currentDepth = Math.max(depthStorage.getStore() ?? 0, Number.isFinite(environmentDepth) ? environmentDepth : 0);
      if (currentDepth + 1 > config.maxDepth) {
        throw new PiSessionError("PI_SESSION_MAX_DEPTH_EXCEEDED", `maximum nested pi_session depth is ${config.maxDepth}`);
      }

      if (input.resume) {
        resumeInfo = await findSession(input.resume);
        notificationSessionId = resumeInfo.id;
        try {
          manager = SessionManager.open(resumeInfo.path);
        } catch (error) {
          throw new PiSessionError("SESSION_OPEN_FAILED", `could not open session ${resumeInfo.id}`, error);
        }
        const storedCwd = manager.getCwd();
        notificationCwd = storedCwd;
        if (input.cwd && normalizeCwd(input.cwd, ctx.cwd) !== resolve(storedCwd)) {
          throw new PiSessionError("INVALID_RESUME_CWD", `resume cwd must remain ${storedCwd}`);
        }
      } else {
        notificationCwd = normalizeCwd(input.cwd ?? ctx.cwd, ctx.cwd);
        manager = SessionManager.create(notificationCwd);
        notificationSessionId = manager.getSessionId();
      }

      const agentDir = config.agentDir ?? getAgentDir();
      const settingsManager = SettingsManager.create(notificationCwd, agentDir);
      const resourceLoader = new DefaultResourceLoader({
        cwd: notificationCwd,
        agentDir,
        settingsManager,
      });
      await resourceLoader.reload();
      const modelRuntime = await ModelRuntime.create({
        authPath: resolve(agentDir, "auth.json"),
        modelsPath: resolve(agentDir, "models.json"),
      });
      const explicitModel = input.model ? exactModel(modelRuntime, input.model) : undefined;
      const created = await createAgentSession({
        cwd: notificationCwd,
        agentDir,
        modelRuntime,
        resourceLoader,
        settingsManager,
        sessionManager: manager,
        ...(explicitModel ? { model: explicitModel } : {}),
      });
      session = created.session;
      notificationSessionId = session.sessionId;
      if (input.thinkingLevel && !input.model && !session.getAvailableThinkingLevels().includes(input.thinkingLevel)) {
        throw new PiSessionError("UNSUPPORTED_THINKING_LEVEL", `${effectiveConfiguration(session, manager).model} does not support ${input.thinkingLevel}`);
      }
      const runtime = await applyRuntimeConfiguration(session, manager, input, explicitModel, Boolean(created.modelFallbackMessage));
      effectiveStart = runtime.effective;
      modelSource = runtime.modelSource;
      thinkingSource = runtime.thinkingSource;
      await notifyStart();

      const messageCountBefore = session.messages.length;
      await depthStorage.run(currentDepth + 1, async () => {
        await session!.prompt(input.prompt, { expandPromptTemplates: true });
        await session!.waitForIdle();
      });
      const response = finalAssistantResponse(session, messageCountBefore);
      effectiveEnd = effectiveConfiguration(session, manager);
      endStatus = (await safeNotify(
        config.notifications,
        buildCompleteNotification(notificationContext(
          trace,
          mode,
          input,
          session.sessionId,
          manager.getCwd(),
          effectiveEnd,
          config,
          Date.now() - startedAt,
          effectiveStart,
          response,
        )),
      )).status;
      const details = resultDetails(trace, mode, input, session, manager, effectiveStart, effectiveEnd, modelSource, thinkingSource, Date.now() - startedAt, startStatus, endStatus, "completed");
      return { content: [{ type: "text", text: response }], details };
    } catch (error) {
      const normalized = asPiSessionError(error);
      await notifyStart();
      endStatus = (await safeNotify(
        config.notifications,
        buildFailedNotification({
          ...notificationContext(
            trace,
            mode,
            input,
            session?.sessionId ?? notificationSessionId,
            manager?.getCwd() ?? notificationCwd,
            effectiveStart,
            config,
            Date.now() - startedAt,
          ),
          errorCode: normalized.code,
          errorMessage: normalized.message,
        }),
      )).status;
      const details = resultDetails(trace, mode, input, session, manager, effectiveStart, effectiveEnd, modelSource, thinkingSource, Date.now() - startedAt, startStatus, endStatus, "failed", normalized.code);
      return {
        content: [{ type: "text", text: normalized.message }],
        details,
        isError: true,
      };
    } finally {
      try {
        session?.dispose();
      } catch {
        // Disposal must not replace the already reported Session result.
      }
    }
  },
});

export default piSessionTool;
