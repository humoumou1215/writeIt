// ============================================================
// debug/registry.ts —— 调试命令注册表（唯一执行体）
//   命令实现集中在 commands.ts；传输层（ws/tauri）只把 {cmd,args}
//   交到这里执行并拿回结果。纯分发，不 import 业务模块（命令实现才 import）。
// ============================================================

export type CommandHandler = (
  args: Record<string, unknown>
) => Promise<unknown> | unknown

const handlers = new Map<string, CommandHandler>()

export function registerCommand(name: string, fn: CommandHandler): void {
  handlers.set(name, fn)
}

export function hasCommand(name: string): boolean {
  return handlers.has(name)
}

/** 执行命令；未知命令 / 抛错统一转成结果，绝不让异常穿透到传输层 */
export async function execute(cmd: string, args: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const fn = handlers.get(cmd)
  if (!fn) return { ok: false, error: `unknown command: ${cmd}` }
  try {
    const data = await fn(args ?? {})
    return { ok: true, data }
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}` : String(e)
    return { ok: false, error: msg }
  }
}
