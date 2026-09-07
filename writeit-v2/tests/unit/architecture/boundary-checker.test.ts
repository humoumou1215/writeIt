import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const checkerPath = fileURLToPath(new URL('../../../scripts/check-boundaries.mjs', import.meta.url))

function runChecker(projectRoot: string) {
  return spawnSync(process.execPath, [checkerPath, '--root', projectRoot], {
    encoding: 'utf8',
  })
}

describe('architecture boundary checker', () => {
  it('accepts the known-good fixture, including AST-supported import forms', () => {
    const projectRoot = fileURLToPath(
      new URL('../../fixtures/architecture/good/', import.meta.url),
    )
    const result = runChecker(projectRoot)

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('architecture boundary check passed')
  })

  it('rejects side-effect, re-export, dynamic, CommonJS, Vue, and reverse-layer violations', () => {
    const projectRoot = fileURLToPath(
      new URL('../../fixtures/architecture/bad/', import.meta.url),
    )
    const result = runChecker(projectRoot)
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(output).toContain('legacy editor-app runtime')
    expect(output).toContain('forbidden Core runtime (vue)')
    expect(output).toContain('forbidden Core runtime (@codemirror/state)')
    expect(output).toContain('layer dependency core -> editor is not allowed')
    expect(output).toContain('layer dependency core -> platform is not allowed')
    expect(output).toContain('explicit synchronization call is not allowed (setTimeout)')
  })
})
