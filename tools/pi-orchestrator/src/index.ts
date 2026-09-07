import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { feishuMessageTool } from "./feishu-message.js";
import { piSessionTool } from "./pi-session.js";

export default function (pi: ExtensionAPI): void {
  pi.registerTool(piSessionTool);
  pi.registerTool(feishuMessageTool);
}

export { feishuMessageTool, piSessionTool };
export type * from "./types.js";
