import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_WORKSPACE_SETTINGS,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  WorkspaceSettingsStore,
} from '../../../../src/application/workspace'
import { MemorySettingsStorage } from '../../../../src/platform/settings'

describe('WorkspaceSettingsStore', () => {
  it('persists shell settings without storing document content', () => {
    const storage = new MemorySettingsStorage()
    const first = new WorkspaceSettingsStore(storage)

    first.update({
      sidebarCollapsed: true,
      sidebarPinned: false,
      sidebarWidth: MAX_SIDEBAR_WIDTH,
      autoSaveDelayMs: null,
      restoreLastWorkspace: false,
      imagePasteMode: 'inline',
    })

    const second = new WorkspaceSettingsStore(storage)
    expect(second.getSnapshot()).toEqual({
      sidebarCollapsed: true,
      sidebarPinned: false,
      sidebarWidth: MAX_SIDEBAR_WIDTH,
      autoSaveDelayMs: null,
      restoreLastWorkspace: false,
      imagePasteMode: 'inline',
    })
    expect(storage.read('writeit-v2.workspace-settings')).not.toContain(
      'markdown',
    )
  })

  it('uses defaults for corrupt or invalid persisted settings', () => {
    const storage = new MemorySettingsStorage({
      'writeit-v2.workspace-settings': JSON.stringify({
        version: 1,
        settings: { sidebarWidth: 99999 },
      }),
    })

    const settings = new WorkspaceSettingsStore(storage)
    expect(settings.getSnapshot()).toEqual(DEFAULT_WORKSPACE_SETTINGS)
    expect(() =>
      settings.update({ sidebarWidth: MIN_SIDEBAR_WIDTH - 1 }),
    ).toThrow()
  })

  it('notifies observers after a successful change and resets atomically', () => {
    const settings = new WorkspaceSettingsStore(new MemorySettingsStorage())
    const seen: boolean[] = []
    settings.subscribe((snapshot) => seen.push(snapshot.sidebarCollapsed))

    settings.update({ sidebarCollapsed: true })
    settings.reset()

    expect(seen).toEqual([true, false])
    expect(settings.getSnapshot().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})
