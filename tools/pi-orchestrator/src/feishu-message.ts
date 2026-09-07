import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "./config.js";
import { sendOpenClawMessage } from "./notifier.js";

interface FeishuDetails {
  channel: "feishu";
  target: string;
  account: string;
  status: "sent" | "failed";
  errorCode?: string;
  messageId?: string;
  response?: unknown;
  error?: string;
}

const feishuMessageParameters = Type.Object({
  message: Type.String({ description: "The exact message content to send to Feishu." }),
  target: Type.Optional(Type.String({ description: "Optional explicit Feishu ou_ or oc_ target. Defaults to configured target." })),
  account: Type.Optional(Type.String({ description: "Optional OpenClaw account. Defaults to configured account." })),
});

export const feishuMessageTool = defineTool<typeof feishuMessageParameters, FeishuDetails>({
  name: "feishu_message",
  label: "Feishu Message",
  description: "Send a message directly to a Feishu target through the local OpenClaw outbound channel. This does not invoke another LLM or create a Pi Session.",
  promptSnippet: "Send a direct Feishu message through OpenClaw",
  promptGuidelines: [
    "Use feishu_message only when a direct Feishu notification is required.",
    "Put the complete message in message; do not use shell syntax or invoke OpenClaw yourself.",
    "The default target comes from the local pi-session-tool configuration. An explicit target must be an ou_ or oc_ id.",
  ],
  parameters: feishuMessageParameters,
  async execute(_toolCallId, params) {
    if (!params.message.trim()) {
      return {
        content: [{ type: "text", text: "INVALID_INPUT: message must not be empty" }],
        details: {
          channel: "feishu",
          target: "unresolved",
          account: "unresolved",
          status: "failed",
          errorCode: "INVALID_INPUT",
        },
        isError: true,
      };
    }

    const loaded = await loadConfig();
    const result = await sendOpenClawMessage(loaded.config.notifications, params.message, {
      ...(params.target ? { target: params.target } : {}),
      ...(params.account ? { account: params.account } : {}),
    });
    const response = result.response as Record<string, unknown> | undefined;
    const messageId = typeof response?.messageId === "string" ? response.messageId : undefined;
    const details: FeishuDetails = {
      channel: "feishu",
      target: result.target,
      account: result.account,
      status: result.status === "sent" ? "sent" as const : "failed" as const,
      ...(result.status === "failed" ? { errorCode: "FEISHU_SEND_FAILED" } : {}),
      ...(messageId ? { messageId } : {}),
      ...(result.response !== undefined ? { response: result.response } : {}),
      ...(result.error ? { error: result.error } : {}),
    };

    if (result.status === "failed") {
      return {
        content: [{ type: "text", text: `FEISHU_SEND_FAILED: ${result.error ?? "unknown error"}` }],
        details,
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Feishu message sent${messageId ? `: ${messageId}` : ""}` }],
      details,
    };
  },
});

export default feishuMessageTool;
