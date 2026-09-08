/**
 * Small synchronous key/value boundary for user preferences and recovery
 * metadata.  The application stores JSON at this boundary; the platform owns
 * whether that JSON lives in localStorage, a desktop settings file, or an
 * in-memory adapter used by tests.
 */
export interface SettingsStoragePort {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
}

/** Compatibility name for adapters that model this as a generic key/value port. */
export type KeyValueStoragePort = SettingsStoragePort

function requireKey(key: string): string {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new TypeError('Settings storage key must be a non-empty string')
  }
  return key
}

function requireValue(value: string): string {
  if (typeof value !== 'string') {
    throw new TypeError('Settings storage value must be a string')
  }
  return value
}

/** Deterministic adapter for unit tests and browser/mock application state. */
export class MemorySettingsStorage implements SettingsStoragePort {
  private readonly values = new Map<string, string>()

  constructor(initial: Readonly<Record<string, string>> = {}) {
    if (initial === null || typeof initial !== 'object') {
      throw new TypeError('Initial settings storage must be an object')
    }

    for (const [key, value] of Object.entries(initial)) {
      this.values.set(requireKey(key), requireValue(value))
    }
  }

  read(key: string): string | null {
    const normalizedKey = requireKey(key)
    return this.values.get(normalizedKey) ?? null
  }

  write(key: string, value: string): void {
    this.values.set(requireKey(key), requireValue(value))
  }

  remove(key: string): void {
    this.values.delete(requireKey(key))
  }

  /** Returns a defensive copy for assertions and diagnostics. */
  snapshot(): ReadonlyMap<string, string> {
    return new Map(this.values)
  }
}

function resolveBrowserStorage(): Storage | undefined {
  try {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return undefined
    }
    return globalThis.localStorage
  } catch {
    // SecurityError/private browsing can make localStorage unavailable. The
    // adapter becomes a safe no-op rather than making the editor unusable.
    return undefined
  }
}

/**
 * Browser adapter for settings/recovery metadata.
 *
 * Every operation is best-effort: a blocked or quota-exhausted browser
 * storage must not prevent editing. Desktop adapters can implement the same
 * port with durable application storage without changing the application
 * state model.
 */
export class BrowserSettingsStorage implements SettingsStoragePort {
  private readonly storage: Storage | undefined

  constructor(storage?: Storage) {
    this.storage = storage ?? resolveBrowserStorage()
  }

  read(key: string): string | null {
    const normalizedKey = requireKey(key)
    if (!this.storage) return null
    try {
      return this.storage.getItem(normalizedKey)
    } catch {
      return null
    }
  }

  write(key: string, value: string): void {
    const normalizedKey = requireKey(key)
    const normalizedValue = requireValue(value)
    if (!this.storage) return
    try {
      this.storage.setItem(normalizedKey, normalizedValue)
    } catch {
      // Settings are convenience state. A platform storage failure should
      // degrade persistence, not interrupt the authoritative Markdown path.
    }
  }

  remove(key: string): void {
    const normalizedKey = requireKey(key)
    if (!this.storage) return
    try {
      this.storage.removeItem(normalizedKey)
    } catch {
      // See write(): browser storage is deliberately non-fatal.
    }
  }
}
