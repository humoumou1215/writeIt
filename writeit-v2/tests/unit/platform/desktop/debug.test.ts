import { describe, expect, it } from 'vitest'
import { DesktopDebugPolicy } from '../../../../src/platform/desktop'

describe('desktop debug policy', () => {
  it('defaults closed and never allows high-risk LAN exec', () => {
    expect(new DesktopDebugPolicy().allows('diagnostics.read', true)).toBe(false)
    const policy = new DesktopDebugPolicy('lan')
    expect(policy.allows('diagnostics.read', true)).toBe(true)
    expect(policy.allows('exec', true)).toBe(false)
    expect(policy.allows('diagnostics.read', false)).toBe(false)
  })
})
