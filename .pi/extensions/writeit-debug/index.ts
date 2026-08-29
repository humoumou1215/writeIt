// ============================================================
// writeit-debug —— Pi 扩展：注册 writeit 工具（WriteIt 现场勘查）
//   薄壳：结构化参数 → 一帧 RPC → JSON 回传。协议实现复用
//   editor-app/scripts/_rpc-client.mjs（与 writeit-cli 同一出处）。
//   连接发现：tauri 桌面版读发现文件（debug.json）；dev 模式连 vite 中继。
//   使用场景：用户报告 WriteIt 运行时问题 → 就地勘查（不要求复现）。
// ============================================================
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { resolveTarget, openSession, rpcRequest, listInstances } from "../../../editor-app/scripts/_rpc-client.mjs";
import { writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** CLI 风格别名 → 后端命令（registry 只认后端命令名） */
const ALIASES: Record<string, string> = {
  status: 'app.info',
  tabs: 'tabs.list',
  md: 'doc.markdown',
  selection: 'doc.selection',
  refs: 'refs.registry',
  broken: 'refs.broken',
  dom: 'dom.snapshot',
  editor: 'editor.probe',
  perf: 'perf.monitor',
  git: 'git.status',
  logs: 'logs.tail',
  console: 'console.tail',
  events: 'events.since',
  shot: 'screenshot',
  mockfs: 'mockfs.state',
  run: 'action.run',
  exec: 'exec',
};

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "writeit",
    label: "WriteIt Debug",
    description:
      "检查/操作正在运行的 WriteIt 编辑器实例（桌面版 TCP 或 vite dev 中继）。用于现场勘查：标签、文档内容、引用同步状态（refs.registry 的 stale 视图表）、DOM/渲染几何、日志、截图，以及 save/open/viewMode 等语义操作。多实例/多客户端场景：先 instances（Tauri 注册表）或 clients（vite 页面）列目标，再用 instance / client 参数指认。用户报告 WriteIt 运行问题（引用不同步/渲染不对/报错）时首选此工具，而不是让用户复现。",
    promptSnippet: "Inspect or drive a running WriteIt editor instance (tabs, markdown, ref-sync state, DOM, logs, screenshot, actions)",
    promptGuidelines: [
      "用户报告 WriteIt 运行时问题时，先用 writeit 工具勘查现场（status → refs.registry / tabs / dom.snapshot / logs.tail），不要要求用户复现。",
      "引用同步问题先看 refs.registry：stale=true 的视图是失步方；再 events.since 看最近 refs.broadcast；doc.markdown 对质宿主内容。",
      "渲染问题用 dom.snapshot（几何/面板/裁剪）+ screenshot（落盘后 read 读图）。",
      "需要操作现场时用 action.run（save/open/viewMode/closeTab），先与用户确认。",
      "screenshot 命令会写临时 PNG 文件并返回路径——用 read 工具读图确认。",
    ],
    parameters: Type.Object({
      command: StringEnum([
        "status", "tabs", "md", "selection", "refs", "broken", "dom", "editor", "perf", "git", "logs", "console", "events", "shot", "mockfs", "run", "exec", "clients", "instances",
        // 后端命令名（等价）
        "app.info", "tabs.list", "doc.markdown", "doc.selection", "refs.registry", "refs.broken", "dom.snapshot", "editor.probe", "perf.monitor", "git.status", "logs.tail", "console.tail", "events.since", "screenshot", "mockfs.state", "action.run",
      ] as const),
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      host: Type.Optional(Type.String({ description: "目标主机（默认自动发现；SSH 场景指 VM 本机，如 127.0.0.1）" })),
      port: Type.Optional(Type.Number({ description: "目标端口（TCP 模式）" })),
      transport: Type.Optional(StringEnum(["auto", "tcp", "ws"] as const)),
      instance: Type.Optional(Type.String({ description: "Tauri 实例标识（设置页「实例标识」展示；多实例并存时据此指认，如 w123-…）" })),
      client: Type.Optional(Type.String({ description: "vite 中继的页面 client id（多设备同时打开网页时指定，如 c3）" })),
    }),
    async execute(toolCallId, params, signal) {
      // instances：本机 tauri 实例注册表扫描（不连接；配合 instance 参数指认）
      if (params.command === "instances") {
        const insts = await listInstances()
        const text = insts.length
          ? "Tauri 实例（本机，按 pid 探活）：\n" + insts.map((i) => `${i.instanceId}  pid=${i.pid} mode=${i.mode} port=${i.port} root=${i.root ?? ""}`).join("\n") +
            "\n连接指定实例：writeit 工具带 instance 参数，如 {command: status, instance: <instanceId>}"
          : "(本机无存活 Tauri 调试实例；若在跑，请在设置页「🔌调试通道」开启；vite 页面请用 clients 查看)"
        return { content: [{ type: "text", text }], details: { command: params.command, ok: true } }
      }

      // 每次执行重新解析目标（不缓存：实例/客户端列表随时变化）
      let target: any
      try {
        target = await resolveTarget({
          host: params.host,
          port: params.port,
          transport: params.transport ?? (params.host ? "auto" : undefined),
          instance: params.instance,
        })
      } catch (e) {
        return {
          content: [{ type: "text", text: `[writeit] 目标解析失败: ${e instanceof Error ? e.message : String(e)}` }],
          details: { command: params.command, ok: false },
        }
      }

      let data
      let backendCmd
      try {
        // 别名映射（CLI 风格 → 后端命令）；clients 是中继/本地命令，直通
        backendCmd = ALIASES[params.command] ?? params.command
        // 指定 client：同一连接上先 use 再发命令（ws 中继）
        if (params.client) {
          const s = await openSession(target)
          try {
            await s.request("use", { client: params.client }, { timeoutMs: 4000 })
            data = await s.request(backendCmd, params.args ?? {}, { timeoutMs: 20000, signal })
          } finally {
            s.close()
          }
        } else {
          data = await rpcRequest(target, backendCmd, params.args ?? {}, { timeoutMs: 20000, signal })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          content: [{ type: "text", text: `[writeit] 连接失败: ${msg}\n（检查：① 设置页开启调试通道；② 多实例时用 instance 参数指认（写 writeit instances 看列表）；③ 多页面时用 client 参数指认（写 writeit clients 看列表）；④ dev 模式 vite 在 5173 运行；⑤ SSH 场景 host 指向 VM）` }],
          details: { command: params.command, ok: false, error: msg },
        }
      }

      // screenshot（含别名 shot）：dataURL → 落盘 PNG，返回路径（Agent 用 read 读图）
      if (backendCmd === "screenshot" && typeof data === "string") {
        const b64 = data.replace(/^data:image\/png;base64,/, "");
        const dir = path.join(os.tmpdir(), "writeit-shots");
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, `shot-${Date.now()}.png`);
        await writeFile(file, Buffer.from(b64, "base64"));
        return {
          content: [{ type: "text", text: `screenshot 已保存: ${file}\n用 read 工具读取该 PNG 查看界面。` }],
          details: { command: params.command, ok: true, file },
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { command: params.command, ok: true, data },
      };
    },
  });
}