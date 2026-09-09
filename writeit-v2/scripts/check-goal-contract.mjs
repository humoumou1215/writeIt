import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(root, '..')

const requiredFiles = [
  'docs/GOAL.md',
  'docs/DECISIONS.md',
  'docs/STATUS.md',
  'docs/MILESTONES.md',
  'docs/adr/ADR-0007-annotation-workspace-sidecar-persistence.md',
  'docs/adr/ADR-0008-template-provider-runtime-boundary.md',
]

const missingFiles = requiredFiles.filter((path) => !existsSync(resolve(root, path)))

if (missingFiles.length > 0) {
  throw new Error(`Missing Goal contract files:\n${missingFiles.map((path) => `- ${path}`).join('\n')}`)
}

const spec = readFileSync(resolve(root, 'docs/IMPLEMENTATION_SPEC.md'), 'utf8')
const featureMap = readFileSync(resolve(repositoryRoot, 'LEGACY_FEATURE_MAP.md'), 'utf8')
const goal = readFileSync(resolve(root, 'docs/GOAL.md'), 'utf8')
const status = readFileSync(resolve(root, 'docs/STATUS.md'), 'utf8')
const adrIndex = readFileSync(resolve(root, 'docs/adr/README.md'), 'utf8')

const linkedContractFiles = [...requiredFiles, 'docs/adr/README.md']

for (const contractFile of linkedContractFiles) {
  const absoluteContractFile = resolve(root, contractFile)
  const markdown = readFileSync(absoluteContractFile, 'utf8')
  const links = markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)

  for (const [, rawTarget] of links) {
    if (/^(?:[a-z]+:|#)/i.test(rawTarget)) {
      continue
    }

    const target = rawTarget.split('#', 1)[0]

    if (!existsSync(resolve(dirname(absoluteContractFile), target))) {
      throw new Error(`${contractFile} has a missing local link target: ${rawTarget}`)
    }
  }
}

const taskIdPattern = /\bP\d+A?(?:-[A-Z]+\d+|-\d+)(?:-[A-Z0-9]+)*\b/g
const referencedTaskIds = [...new Set(featureMap.match(taskIdPattern) ?? [])].sort()
const unknownTaskIds = referencedTaskIds.filter((taskId) => !spec.includes(taskId))

if (unknownTaskIds.length > 0) {
  throw new Error(
    `LEGACY_FEATURE_MAP.md references Task IDs absent from IMPLEMENTATION_SPEC.md:\n${unknownTaskIds
      .map((taskId) => `- ${taskId}`)
      .join('\n')}`,
  )
}

for (const checkpoint of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']) {
  if (!goal.includes(`| **${checkpoint}** |`)) {
    throw new Error(`GOAL.md is missing checkpoint ${checkpoint}`)
  }

  if (!status.includes(`| ${checkpoint} |`)) {
    throw new Error(`STATUS.md is missing checkpoint ${checkpoint}`)
  }
}

for (const adr of ['ADR-0007', 'ADR-0008']) {
  if (!adrIndex.includes(adr)) {
    throw new Error(`ADR index is missing ${adr}`)
  }
}

console.log(
  `Goal contract check passed (${requiredFiles.length} required files, ${linkedContractFiles.length} linked contract files, ${referencedTaskIds.length} feature-map Task IDs, 9 checkpoints).`,
)
