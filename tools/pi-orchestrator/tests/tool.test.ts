import { describe, expect, it } from "vitest";
import { feishuMessageTool } from "../src/feishu-message.js";
import { piSessionTool } from "../src/pi-session.js";

describe("Pi extension tools", () => {
  it("exposes the required structured tools", () => {
    expect(piSessionTool.name).toBe("pi_session");
    expect(piSessionTool.parameters).toBeDefined();
    expect(piSessionTool.description).toContain("persistent Pi Session");
    expect(feishuMessageTool.name).toBe("feishu_message");
    expect(feishuMessageTool.parameters).toBeDefined();
  });
});
