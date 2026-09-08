import type { AutoSaveDelayMs } from '../persistence'
import {
  DEFAULT_IMAGE_PASTE_MODE,
  requireImagePasteMode,
} from '../../core/workspace'
import type { ImagePasteMode } from '../../core/workspace'
import type { SettingsStoragePort } from '../../platform/settings'

export const WORKSPACE_SETTINGS_STORAGE_KEY = 'writeit-v2.workspace-settings'

export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 440
export const DEFAULT_SIDEBAR_WIDTH = 296

export interface WorkspaceSettings {
  /** Whether the workspace tree is currently reduced to its rail. */
  readonly sidebarCollapsed: boolean
  /** Whether the sidebar should remain visible in the workspace shell. */
  readonly sidebarPinned: boolean
  /** Sidebar width in CSS pixels when it is expanded. */
  readonly sidebarWidth: number
  /** `null` means manual save. */
  readonly autoSaveDelayMs: AutoSaveDelayMs
  /** Whether the application should reopen the previous workspace session. */
  readonly restoreLastWorkspace: boolean
  /** Strategy used when an image is pasted into the active Markdown document. */
  readonly imagePasteMode: ImagePasteMode
}

export type WorkspaceSettingsPatch = Partial<WorkspaceSettings>

export interface WorkspaceSettingsStoreOptions {
  readonly storageKey?: string
  readonly defaults?: WorkspaceSettingsPatch
}

export type WorkspaceSettingsListener = (settings: WorkspaceSettings) => void
export type WorkspaceSettingsUnsubscribe = () => void

export class WorkspaceSettingsValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceSettingsValidationError'
  }
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = Object.freeze({
  sidebarCollapsed: false,
  sidebarPinned: true,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  autoSaveDelayMs: 1_000,
  restoreLastWorkspace: true,
  imagePasteMode: DEFAULT_IMAGE_PASTE_MODE,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkspaceSettingsValidationError(`${name} must be a boolean`)
  }
  return value
}

function requireSidebarWidth(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MIN_SIDEBAR_WIDTH ||
    value > MAX_SIDEBAR_WIDTH
  ) {
    throw new WorkspaceSettingsValidationError(
      `Sidebar width must be an integer between ${MIN_SIDEBAR_WIDTH} and ${MAX_SIDEBAR_WIDTH}`,
    )
  }
  return value
}

function requireAutoSaveDelay(value: unknown): AutoSaveDelayMs {
  if (
    value !== null &&
    (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new WorkspaceSettingsValidationError(
      'Auto-save delay must be null or a non-negative safe integer',
    )
  }
  return value as AutoSaveDelayMs
}

function normalizeSettings(
  input: WorkspaceSettingsPatch | Record<string, unknown>,
  fallback: WorkspaceSettings,
): WorkspaceSettings {
  if (!isRecord(input)) {
    throw new WorkspaceSettingsValidationError('Workspace settings must be an object')
  }

  return Object.freeze({
    sidebarCollapsed:
      input.sidebarCollapsed === undefined
        ? fallback.sidebarCollapsed
        : requireBoolean(input.sidebarCollapsed, 'sidebarCollapsed'),
    sidebarPinned:
      input.sidebarPinned === undefined
        ? fallback.sidebarPinned
        : requireBoolean(input.sidebarPinned, 'sidebarPinned'),
    sidebarWidth:
      input.sidebarWidth === undefined
        ? fallback.sidebarWidth
        : requireSidebarWidth(input.sidebarWidth),
    autoSaveDelayMs:
      input.autoSaveDelayMs === undefined
        ? fallback.autoSaveDelayMs
        : requireAutoSaveDelay(input.autoSaveDelayMs),
    restoreLastWorkspace:
      input.restoreLastWorkspace === undefined
        ? fallback.restoreLastWorkspace
        : requireBoolean(input.restoreLastWorkspace, 'restoreLastWorkspace'),
    imagePasteMode:
      input.imagePasteMode === undefined
        ? fallback.imagePasteMode
        : requireImagePasteMode(input.imagePasteMode),
  })
}

function normalizeDefaults(
  defaults: WorkspaceSettingsPatch | undefined,
): WorkspaceSettings {
  return normalizeSettings(defaults ?? {}, DEFAULT_WORKSPACE_SETTINGS)
}

function decodeSettings(
  raw: string | null,
  defaults: WorkspaceSettings,
): WorkspaceSettings {
  if (raw === null) return defaults

  try {
    const decoded: unknown = JSON.parse(raw)
    if (!isRecord(decoded)) return defaults
    if (decoded.version !== 1 || !isRecord(decoded.settings)) return defaults
    return normalizeSettings(decoded.settings, defaults)
  } catch {
    // A corrupt or old settings record must never block application startup.
    return defaults
  }
}

function encodeSettings(settings: WorkspaceSettings): string {
  return JSON.stringify({ version: 1, settings })
}

function requirePatch(patch: WorkspaceSettingsPatch): WorkspaceSettingsPatch {
  if (!isRecord(patch)) {
    throw new WorkspaceSettingsValidationError('Settings patch must be an object')
  }
  return patch
}

/**
 * Persistent application settings, kept outside DocumentStore. The store
 * publishes immutable snapshots and writes only preferences; it never stores
 * Markdown, editor state, or a Document revision.
 */
export class WorkspaceSettingsStore {
  private readonly storage: SettingsStoragePort

  private readonly storageKey: string

  private readonly defaults: WorkspaceSettings

  private readonly listeners = new Set<WorkspaceSettingsListener>()

  private snapshot: WorkspaceSettings

  constructor(
    storage: SettingsStoragePort,
    options: WorkspaceSettingsStoreOptions = {},
  ) {
    if (storage === null || typeof storage !== 'object') {
      throw new TypeError('Workspace settings storage is required')
    }
    this.storage = storage
    this.storageKey = options.storageKey ?? WORKSPACE_SETTINGS_STORAGE_KEY
    if (
      typeof this.storageKey !== 'string' ||
      this.storageKey.trim().length === 0
    ) {
      throw new WorkspaceSettingsValidationError(
        'Workspace settings storage key must be non-empty',
      )
    }
    this.defaults = normalizeDefaults(options.defaults)
    this.snapshot = decodeSettings(
      this.storage.read(this.storageKey),
      this.defaults,
    )
  }

  getSnapshot(): WorkspaceSettings {
    return this.snapshot
  }

  subscribe(listener: WorkspaceSettingsListener): WorkspaceSettingsUnsubscribe {
    if (typeof listener !== 'function') {
      throw new TypeError('Workspace settings listener must be a function')
    }
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  update(patch: WorkspaceSettingsPatch): WorkspaceSettings {
    const normalizedPatch = requirePatch(patch)
    const next = normalizeSettings(
      { ...this.snapshot, ...normalizedPatch },
      this.defaults,
    )
    if (settingsEqual(next, this.snapshot)) return this.snapshot

    this.persist(next)
    this.snapshot = next
    this.notify()
    return next
  }

  replace(settings: WorkspaceSettings): WorkspaceSettings {
    const next = normalizeSettings(settings, this.defaults)
    if (settingsEqual(next, this.snapshot)) return this.snapshot

    this.persist(next)
    this.snapshot = next
    this.notify()
    return next
  }

  reset(): WorkspaceSettings {
    return this.replace(this.defaults)
  }

  private persist(settings: WorkspaceSettings): void {
    // SettingsStoragePort implementations may be backed by a desktop file or
    // quota-limited browser storage. The application state is committed only
    // after the adapter accepts the write; BrowserSettingsStorage itself is
    // intentionally best-effort.
    this.storage.write(this.storageKey, encodeSettings(settings))
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.snapshot)
      } catch {
        // Settings are projections for the shell; one observer cannot block
        // another observer or affect document authority.
      }
    }
  }
}

function settingsEqual(
  left: WorkspaceSettings,
  right: WorkspaceSettings,
): boolean {
  return (
    left.sidebarCollapsed === right.sidebarCollapsed &&
    left.sidebarPinned === right.sidebarPinned &&
    left.sidebarWidth === right.sidebarWidth &&
    left.autoSaveDelayMs === right.autoSaveDelayMs &&
    left.restoreLastWorkspace === right.restoreLastWorkspace &&
    left.imagePasteMode === right.imagePasteMode
  )
}
