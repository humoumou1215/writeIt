import { describe, expect, it } from 'vitest'
import { TauriDialogAdapter, TauriPathAdapter, TauriWindowAdapter } from '../../../../src/platform/desktop'

describe('desktop adapters', () => {
  it('maps capabilities to explicit invocations', async () => {
    const calls: string[] = []
    const invoker = { invoke: async <T>(command: string, payload?: Readonly<Record<string, unknown>>) => { calls.push(`${command}:${payload ? JSON.stringify(payload) : ''}`); return (command === 'dialog_confirm' ? true : '') as T } }
    const fs = new TauriPathAdapter(invoker); const window = new TauriWindowAdapter(invoker); const dialog = new TauriDialogAdapter(invoker)
    expect(await fs.readText('a.md')).toBe(''); await fs.writeText('a.md', 'x'); await fs.reveal('a.md'); await window.setTitle('WriteIt'); await window.close(); expect(await dialog.confirm('ok')).toBe(true); await dialog.alert('done')
    expect(calls.map((call) => call.split(':')[0])).toEqual(['fs_read_text', 'fs_write_text', 'window_reveal_path', 'window_set_title', 'window_close', 'dialog_confirm', 'dialog_alert'])
  })
})
