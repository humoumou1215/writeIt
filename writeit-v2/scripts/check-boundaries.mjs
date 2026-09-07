import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const checkerFile = fileURLToPath(import.meta.url)
const defaultProjectRoot = resolve(dirname(checkerFile), '..')

const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|vue)$/i
const SOURCE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  '.cts',
  '.cjs',
  '.vue',
]
const SCRIPT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.mjs',
  '.cts',
  '.cjs',
])

/**
 * The layer policy is intentionally explicit. A resolved relative import is
 * checked against this matrix; package imports are checked separately for
 * Core-specific forbidden runtimes.
 */
export const LAYER_DEPENDENCIES = Object.freeze({
  core: new Set(['core']),
  editor: new Set(['core', 'editor']),
  platform: new Set(['core', 'platform']),
  application: new Set(['core', 'application', 'editor', 'observability', 'platform']),
  ui: new Set(['application', 'core', 'editor', 'observability', 'ui']),
  observability: new Set(['core', 'observability']),
  'app-shell': new Set([
    'app-shell',
    'application',
    'core',
    'editor',
    'observability',
    'platform',
    'ui',
  ]),
})

const FORBIDDEN_CORE_PACKAGE = /^(?:vue|@vue(?:\/|$)|@codemirror(?:\/|$)|@tauri-apps(?:\/|$)|tauri(?:\/|$)|jsdom(?:\/|$)|happy-dom(?:\/|$))/i
const FORBIDDEN_CORE_IDENTIFIERS = new Set([
  'DOMParser',
  'EditorState',
  'EditorView',
  'HTMLElement',
  'window',
])
const FORBIDDEN_DOCUMENT_PROPERTIES = new Set([
  'body',
  'createElement',
  'querySelector',
  'querySelectorAll',
])
const FORBIDDEN_SYNCHRONIZATION_CALLS = new Set([
  'delay',
  'setInterval',
  'setTimeout',
  'sleep',
])

function walk(directory) {
  const files = []
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  )

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(path))
    } else if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
      files.push(path)
    }
  }

  return files
}

function scriptKindForExtension(extension) {
  switch (extension.toLowerCase()) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function scriptKindForVueLanguage(language) {
  switch (language.toLowerCase()) {
    case 'jsx':
      return ts.ScriptKind.JSX
    case 'javascript':
    case 'js':
      return ts.ScriptKind.JS
    case 'tsx':
      return ts.ScriptKind.TSX
    default:
      return ts.ScriptKind.TS
  }
}

/**
 * Extract only Vue SFC script blocks. The contents of every block are parsed
 * by TypeScript below, so import syntax is never discovered by a regex.
 */
function extractVueScripts(source) {
  const scripts = []
  const openingTag = /<script\b([^>]*)>/gi
  let openingMatch

  while ((openingMatch = openingTag.exec(source)) !== null) {
    const contentStart = openingTag.lastIndex
    const closingTag = /<\/script\s*>/gi
    closingTag.lastIndex = contentStart
    const closingMatch = closingTag.exec(source)
    if (!closingMatch) {
      scripts.push({
        content: source.slice(contentStart),
        offset: contentStart,
        scriptKind: scriptKindForVueLanguage('ts'),
        parseError: 'unterminated <script> block',
      })
      break
    }

    const attributes = openingMatch[1]
    const languageMatch = /\blang\s*=\s*(["'])(.*?)\1/i.exec(attributes)
    const language = languageMatch?.[2] ?? 'ts'
    scripts.push({
      content: source.slice(contentStart, closingMatch.index),
      offset: contentStart,
      scriptKind: scriptKindForVueLanguage(language),
    })
    openingTag.lastIndex = closingMatch.index + closingMatch[0].length
  }

  return scripts
}

function parseSourceFile(path, source) {
  if (extname(path).toLowerCase() === '.vue') {
    return extractVueScripts(source).map((script) => ({
      sourceFile: ts.createSourceFile(
        `${path}.${script.scriptKind === ts.ScriptKind.JS ? 'js' : 'ts'}`,
        script.content,
        ts.ScriptTarget.Latest,
        true,
        script.scriptKind,
      ),
      source,
      offset: script.offset,
      parseError: script.parseError,
    }))
  }

  const extension = extname(path).toLowerCase()
  return [
    {
      sourceFile: ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindForExtension(extension),
      ),
      source,
      offset: 0,
    },
  ]
}

function getStringLiteralText(node) {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text
  }
  return undefined
}

function getStaticMemberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return getStringLiteralText(node.argumentExpression)
  return undefined
}

function getStaticCallModuleSpecifier(node) {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return undefined
  const expression = node.expression
  const firstArgument = getStringLiteralText(node.arguments[0])
  if (firstArgument === undefined) return undefined

  if (ts.isIdentifier(expression) && expression.text === 'require') {
    return { specifier: firstArgument, kind: 'CommonJS require' }
  }

  const memberName = getStaticMemberName(expression)
  if (!memberName) return undefined

  if (
    memberName === 'require' &&
    ((ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'module') ||
      (ts.isElementAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'module'))
  ) {
    return { specifier: firstArgument, kind: 'CommonJS module.require' }
  }

  if (
    memberName === 'resolve' &&
    ((ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'require') ||
      (ts.isElementAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'require'))
  ) {
    return { specifier: firstArgument, kind: 'CommonJS require.resolve' }
  }

  return undefined
}

function collectModuleReferences(sourceFile) {
  const references = []

  function add(specifier, node, kind) {
    if (specifier !== undefined && specifier.length > 0) {
      references.push({ specifier, position: node.getStart(sourceFile), kind })
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      add(getStringLiteralText(node.moduleSpecifier), node.moduleSpecifier, 'import')
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(getStringLiteralText(node.moduleSpecifier), node.moduleSpecifier, 're-export')
    } else if (ts.isImportEqualsDeclaration(node)) {
      const moduleReference = node.moduleReference
      if (ts.isExternalModuleReference(moduleReference)) {
        add(getStringLiteralText(moduleReference.expression), moduleReference.expression, 'import equals')
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument
      if (ts.isLiteralTypeNode(argument)) {
        add(getStringLiteralText(argument.literal), argument.literal, 'type import')
      }
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add(getStringLiteralText(node.arguments[0]), node.expression, 'dynamic import')
      } else {
        const commonJsReference = getStaticCallModuleSpecifier(node)
        if (commonJsReference) {
          add(commonJsReference.specifier, node.expression, commonJsReference.kind)
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return references
}

function getPropertyChain(node) {
  if (ts.isIdentifier(node)) return [node.text]
  if (ts.isPropertyAccessExpression(node)) {
    const parent = getPropertyChain(node.expression)
    return parent ? [...parent, node.name.text] : undefined
  }
  if (ts.isElementAccessExpression(node)) {
    const member = getStringLiteralText(node.argumentExpression)
    const parent = getPropertyChain(node.expression)
    return member !== undefined && parent ? [...parent, member] : undefined
  }
  return undefined
}

function isForbiddenCoreGlobal(node) {
  if (ts.isIdentifier(node)) {
    if (FORBIDDEN_CORE_IDENTIFIERS.has(node.text)) return node.text
    if (/^HTML[A-Z]/.test(node.text)) return node.text
    return undefined
  }

  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
    return undefined
  }

  const chain = getPropertyChain(node)
  if (!chain) return undefined
  if (chain[0] === 'window') return chain.join('.')
  if (chain[0] === 'globalThis' && chain[1] === 'document') return chain.join('.')
  if (chain[0] === 'document' && FORBIDDEN_DOCUMENT_PROPERTIES.has(chain[1])) {
    return chain.join('.')
  }
  return undefined
}

function getCallName(node) {
  if (!ts.isCallExpression(node)) return undefined
  if (ts.isIdentifier(node.expression)) return node.expression.text
  return getStaticMemberName(node.expression)
}

function isWithin(directory, path) {
  const pathRelativeToDirectory = relative(directory, path)
  return pathRelativeToDirectory !== '' && !pathRelativeToDirectory.startsWith('..') && !isAbsolute(pathRelativeToDirectory)
}

function isFile(path) {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

function moduleCandidates(candidate) {
  const candidates = [candidate]
  const extension = extname(candidate).toLowerCase()
  if (SCRIPT_EXTENSIONS.has(extension) || extension === '.vue') {
    candidates.push(candidate.slice(0, -extension.length))
  }

  for (const extensionCandidate of SOURCE_EXTENSIONS) {
    candidates.push(`${candidate}${extensionCandidate}`)
  }
  candidates.push(join(candidate, 'index.ts'))
  candidates.push(join(candidate, 'index.tsx'))
  candidates.push(join(candidate, 'index.js'))
  candidates.push(join(candidate, 'index.jsx'))
  candidates.push(join(candidate, 'index.mts'))
  candidates.push(join(candidate, 'index.mjs'))
  candidates.push(join(candidate, 'index.cts'))
  candidates.push(join(candidate, 'index.cjs'))
  candidates.push(join(candidate, 'index.vue'))

  return [...new Set(candidates)]
}

function resolveRelativeModule(fromPath, specifier) {
  if (!specifier.startsWith('.')) return undefined
  const candidate = resolve(dirname(fromPath), specifier)
  return moduleCandidates(candidate).find(isFile)
}

function layerForPath(sourceRoot, path) {
  const sourceRelativePath = relative(sourceRoot, path)
  const firstDirectory = sourceRelativePath.split(/[\\/]/)[0]
  return LAYER_DEPENDENCIES[firstDirectory] ? firstDirectory : 'app-shell'
}

function formatPosition(source, offset) {
  const boundedOffset = Math.max(0, Math.min(offset, source.length))
  let line = 1
  let lineStart = 0
  for (let index = 0; index < boundedOffset; index += 1) {
    if (source[index] === '\n') {
      line += 1
      lineStart = index + 1
    }
  }
  return `${line}:${boundedOffset - lineStart + 1}`
}

function displayPath(projectRoot, path) {
  const projectRelativePath = relative(projectRoot, path)
  return projectRelativePath || basename(path)
}

function addViolation(violations, projectRoot, path, source, offset, message) {
  violations.push(`${displayPath(projectRoot, path)}:${formatPosition(source, offset)} ${message}`)
}

function inspectParsedSource({ projectRoot, sourceRoot, path, parsed, violations }) {
  if (parsed.parseError) {
    addViolation(violations, projectRoot, path, parsed.source, parsed.offset, `Vue SFC parse error (${parsed.parseError})`)
  }

  for (const diagnostic of parsed.sourceFile.parseDiagnostics) {
    const diagnosticOffset = diagnostic.start ?? 0
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
    addViolation(
      violations,
      projectRoot,
      path,
      parsed.source,
      parsed.offset + diagnosticOffset,
      `TypeScript parse error (${message})`,
    )
  }

  const sourceLayer = layerForPath(sourceRoot, path)
  const isCore = sourceLayer === 'core'
  const references = collectModuleReferences(parsed.sourceFile)

  for (const reference of references) {
    const normalizedSpecifier = reference.specifier.replaceAll('\\', '/')
    if (/(^|\/)editor-app(?:\/|$)/i.test(normalizedSpecifier)) {
      addViolation(
        violations,
        projectRoot,
        path,
        parsed.source,
        parsed.offset + reference.position,
        `${reference.kind} of legacy editor-app runtime (${reference.specifier})`,
      )
    }

    if (isCore && FORBIDDEN_CORE_PACKAGE.test(reference.specifier)) {
      addViolation(
        violations,
        projectRoot,
        path,
        parsed.source,
        parsed.offset + reference.position,
        `${reference.kind} of forbidden Core runtime (${reference.specifier})`,
      )
    }

    const relativeTarget = reference.specifier.startsWith('.')
      ? resolve(dirname(path), reference.specifier)
      : undefined
    const resolvedPath =
      relativeTarget === undefined
        ? undefined
        : resolveRelativeModule(path, reference.specifier) ?? relativeTarget
    if (!resolvedPath) continue

    if (!isWithin(sourceRoot, resolvedPath)) {
      addViolation(
        violations,
        projectRoot,
        path,
        parsed.source,
        parsed.offset + reference.position,
        `relative dependency escapes src (${reference.specifier})`,
      )
      continue
    }

    const targetLayer = layerForPath(sourceRoot, resolvedPath)
    const allowedDependencies = LAYER_DEPENDENCIES[sourceLayer]
    if (allowedDependencies && !allowedDependencies.has(targetLayer)) {
      addViolation(
        violations,
        projectRoot,
        path,
        parsed.source,
        parsed.offset + reference.position,
        `layer dependency ${sourceLayer} -> ${targetLayer} is not allowed (${reference.specifier})`,
      )
    }
  }

  function visit(node) {
    const forbiddenGlobal = isForbiddenCoreGlobal(node)
    const parentIsMember =
      node.parent !== undefined &&
      (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
    if (isCore && forbiddenGlobal && !parentIsMember) {
      addViolation(
        violations,
        projectRoot,
        path,
        parsed.source,
        parsed.offset + node.getStart(parsed.sourceFile),
        `Core references a UI/DOM/CM6 global (${forbiddenGlobal})`,
      )
    }

    if (isCore && ts.isCallExpression(node)) {
      const callName = getCallName(node)
      if (callName && FORBIDDEN_SYNCHRONIZATION_CALLS.has(callName)) {
        addViolation(
          violations,
          projectRoot,
          path,
          parsed.source,
          parsed.offset + node.expression.getStart(parsed.sourceFile),
          `explicit synchronization call is not allowed (${callName})`,
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(parsed.sourceFile)
}

/**
 * Check a project root containing a src/ directory. The returned object is
 * deliberately side-effect free so fixture projects can exercise the exact
 * same gate as the CLI.
 */
export function checkBoundaries({ projectRoot = defaultProjectRoot } = {}) {
  const resolvedProjectRoot = resolve(projectRoot)
  const sourceRoot = join(resolvedProjectRoot, 'src')
  const violations = []

  if (!existsSync(sourceRoot)) {
    return {
      projectRoot: resolvedProjectRoot,
      sourceRoot,
      sourceFiles: [],
      violations: [`src directory does not exist (${sourceRoot})`],
    }
  }

  const sourceFiles = walk(sourceRoot)
  for (const path of sourceFiles) {
    let source
    try {
      source = readFileSync(path, 'utf8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      violations.push(`${displayPath(resolvedProjectRoot, path)}: cannot read source (${message})`)
      continue
    }

    for (const parsed of parseSourceFile(path, source)) {
      inspectParsedSource({
        projectRoot: resolvedProjectRoot,
        sourceRoot,
        path,
        parsed,
        violations,
      })
    }
  }

  return {
    projectRoot: resolvedProjectRoot,
    sourceRoot,
    sourceFiles,
    violations,
  }
}

function printResult(result) {
  if (result.violations.length > 0) {
    console.error('WriteIt v2 architecture boundary check failed:')
    for (const violation of result.violations) console.error(`- ${violation}`)
    return false
  }

  console.log(`WriteIt v2 architecture boundary check passed (${result.sourceFiles.length} source files)`)
  return true
}

function projectRootFromArguments(argumentsList) {
  if (argumentsList.length === 0) return defaultProjectRoot
  if (argumentsList.length === 2 && argumentsList[0] === '--root') return resolve(argumentsList[1])
  if (argumentsList.length === 1 && !argumentsList[0].startsWith('-')) return resolve(argumentsList[0])
  throw new Error('Usage: node scripts/check-boundaries.mjs [--root <project-root>]')
}

if (process.argv[1] && resolve(process.argv[1]) === checkerFile) {
  try {
    const result = checkBoundaries({ projectRoot: projectRootFromArguments(process.argv.slice(2)) })
    process.exitCode = printResult(result) ? 0 : 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}
