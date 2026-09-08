declare const workspacePathBrand: unique symbol

/**
 * A canonical path inside a workspace. Workspace paths are deliberately
 * relative and use `/` regardless of the host platform. The empty path is
 * reserved for the workspace root.
 */
export type WorkspacePath = string & {
  readonly [workspacePathBrand]: 'WorkspacePath'
}

export type WorkspaceEntryKind = 'file' | 'directory'

export interface WorkspaceFileNode {
  readonly kind: 'file'
  readonly path: WorkspacePath
  readonly name: string
}

export interface WorkspaceDirectoryNode {
  readonly kind: 'directory'
  readonly path: WorkspacePath
  readonly name: string
  readonly children: readonly WorkspaceNode[]
}

export type WorkspaceNode = WorkspaceFileNode | WorkspaceDirectoryNode

export interface WorkspaceTree {
  readonly root: WorkspaceDirectoryNode
}

/** A direct child returned by a filesystem adapter. */
export interface WorkspaceEntry {
  readonly kind: WorkspaceEntryKind
  readonly path: WorkspacePath
  readonly name: string
}

export interface FlattenedWorkspaceNode {
  readonly node: WorkspaceNode
  readonly depth: number
  readonly parentPath: WorkspacePath
}

function requirePathString(value: string, name: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`)
  }

  return value
}

/**
 * Converts a workspace path to its canonical relative representation.
 * Traversal, absolute paths and ambiguous dot segments are rejected instead
 * of being silently redirected to another workspace entry.
 */
export function createWorkspacePath(value: string): WorkspacePath {
  const raw = requirePathString(value, 'Workspace path').replaceAll('\\', '/')

  if (raw === '' || raw === '.') return '' as WorkspacePath
  if (raw.startsWith('/')) {
    throw new TypeError('Workspace path must be relative')
  }

  const segments = raw.split('/')
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  ) {
    throw new TypeError(
      'Workspace path must not contain empty, dot, or parent segments',
    )
  }

  return segments.join('/') as WorkspacePath
}

export function isWorkspacePath(value: unknown): value is WorkspacePath {
  if (typeof value !== 'string') return false

  try {
    return createWorkspacePath(value) === value
  } catch {
    return false
  }
}

export function workspaceName(path: WorkspacePath): string {
  const normalized = createWorkspacePath(path)
  if (normalized === '') return 'Workspace'
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function workspaceParent(path: WorkspacePath): WorkspacePath {
  const normalized = createWorkspacePath(path)
  if (normalized === '') return '' as WorkspacePath

  const separator = normalized.lastIndexOf('/')
  return (separator < 0
    ? ''
    : normalized.slice(0, separator)) as WorkspacePath
}

export function workspaceJoin(
  parent: WorkspacePath,
  name: string,
): WorkspacePath {
  const normalizedParent = createWorkspacePath(parent)
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('Workspace entry name must be non-empty')
  }
  if (name === '.' || name === '..' || /[\\/]/u.test(name)) {
    throw new TypeError('Workspace entry name must be a single path segment')
  }

  return createWorkspacePath(
    normalizedParent === '' ? name : `${normalizedParent}/${name}`,
  )
}

/** Returns true when `path` is the same as or nested below `parent`. */
export function isWorkspacePathWithin(
  path: WorkspacePath,
  parent: WorkspacePath,
): boolean {
  const normalizedPath = createWorkspacePath(path)
  const normalizedParent = createWorkspacePath(parent)

  return (
    normalizedPath === normalizedParent ||
    (normalizedParent === ''
      ? normalizedPath.length > 0
      : normalizedPath.startsWith(`${normalizedParent}/`))
  )
}

export function createWorkspaceFileNode(
  path: WorkspacePath,
  name = workspaceName(path),
): WorkspaceFileNode {
  const normalizedPath = createWorkspacePath(path)
  if (normalizedPath === '') {
    throw new TypeError('A workspace root cannot be a file')
  }

  return Object.freeze({
    kind: 'file' as const,
    path: normalizedPath,
    name,
  })
}

export function createWorkspaceDirectoryNode(
  path: WorkspacePath,
  children: readonly WorkspaceNode[] = [],
  name = workspaceName(path),
): WorkspaceDirectoryNode {
  const normalizedPath = createWorkspacePath(path)

  return Object.freeze({
    kind: 'directory' as const,
    path: normalizedPath,
    name,
    children: sortWorkspaceNodes(children),
  })
}

export function createWorkspaceTree(
  rootPath: WorkspacePath = '' as WorkspacePath,
  children: readonly WorkspaceNode[] = [],
  rootName = workspaceName(rootPath),
): WorkspaceTree {
  return Object.freeze({
    root: createWorkspaceDirectoryNode(rootPath, children, rootName),
  })
}

export function sortWorkspaceNodes(
  nodes: readonly WorkspaceNode[],
): readonly WorkspaceNode[] {
  return Object.freeze(
    [...nodes].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1

      const leftName = left.name.toLocaleLowerCase('en-US')
      const rightName = right.name.toLocaleLowerCase('en-US')
      return leftName.localeCompare(rightName, 'en-US') || left.name.localeCompare(right.name, 'en-US')
    }),
  )
}

export function flattenWorkspaceTree(
  tree: WorkspaceTree,
  includeRoot = false,
): readonly FlattenedWorkspaceNode[] {
  const flattened: FlattenedWorkspaceNode[] = []

  function visit(node: WorkspaceNode, depth: number): void {
    if (includeRoot || node !== tree.root) {
      flattened.push(
        Object.freeze({
          node,
          depth,
          parentPath: workspaceParent(node.path),
        }),
      )
    }

    if (node.kind === 'directory') {
      for (const child of node.children) visit(child, depth + 1)
    }
  }

  visit(tree.root, 0)
  return Object.freeze(flattened)
}

export function findWorkspaceNode(
  tree: WorkspaceTree,
  path: WorkspacePath,
): WorkspaceNode | undefined {
  const normalizedPath = createWorkspacePath(path)
  if (tree.root.path === normalizedPath) return tree.root

  function find(node: WorkspaceDirectoryNode): WorkspaceNode | undefined {
    for (const child of node.children) {
      if (child.path === normalizedPath) return child
      if (child.kind === 'directory') {
        const match = find(child)
        if (match) return match
      }
    }
    return undefined
  }

  return find(tree.root)
}
