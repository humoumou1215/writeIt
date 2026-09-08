/**
 * A source-level edit independent of CodeMirror, Vue, the DOM, and platform
 * adapters. Positions are UTF-16 offsets, matching JavaScript string offsets.
 */
export interface SourceChange {
  readonly from: number
  readonly to: number
  readonly deleted: string
  readonly inserted: string
}

/**
 * An ordered, non-overlapping set of edits against one source string. Every
 * change carries the deleted source segment so it can be inverted without
 * retaining the complete document.
 */
export interface SourceChangeSet {
  readonly sourceLength: number
  readonly targetLength: number
  readonly changes: readonly SourceChange[]
}

export interface SourceChangeSpec {
  readonly from: number
  readonly to: number
  readonly insert: string
}

/** A sequence is used to group several committed edits into one undo entry. */
export interface SourceChangeSequence {
  readonly sourceLength: number
  readonly targetLength: number
  readonly changes: readonly SourceChangeSet[]
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string`)
  }
}

function requireLength(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function requirePosition(position: number, length: number, name: string): void {
  if (!Number.isSafeInteger(position) || position < 0 || position > length) {
    throw new RangeError(`${name} must be between 0 and ${length}`)
  }
}

function freezeChange(change: SourceChange): SourceChange {
  return Object.freeze({
    from: change.from,
    to: change.to,
    deleted: change.deleted,
    inserted: change.inserted,
  })
}

function createValidatedSourceChangeSet(
  sourceLength: number,
  changes: readonly SourceChange[],
): SourceChangeSet {
  const normalizedSourceLength = requireLength(sourceLength, 'Source length')
  let previousTo = 0
  let targetLength = normalizedSourceLength
  const normalizedChanges: SourceChange[] = []

  for (const change of changes) {
    if (change === null || typeof change !== 'object') {
      throw new TypeError('Source change must be an object')
    }
    requirePosition(change.from, normalizedSourceLength, 'Source change.from')
    requirePosition(change.to, normalizedSourceLength, 'Source change.to')
    if (change.to < change.from) {
      throw new RangeError('Source change.to cannot precede from')
    }
    if (change.from < previousTo) {
      throw new RangeError('Source changes must be ordered and non-overlapping')
    }
    requireString(change.deleted, 'Source change.deleted')
    requireString(change.inserted, 'Source change.inserted')
    if (change.deleted.length !== change.to - change.from) {
      throw new RangeError(
        'Source change.deleted length must match its replaced source range',
      )
    }

    targetLength += change.inserted.length - (change.to - change.from)
    if (targetLength < 0 || !Number.isSafeInteger(targetLength)) {
      throw new RangeError('Source change target length is invalid')
    }
    normalizedChanges.push(freezeChange(change))
    previousTo = change.to
  }

  return Object.freeze({
    sourceLength: normalizedSourceLength,
    targetLength,
    changes: Object.freeze(normalizedChanges),
  })
}

/**
 * Validates and defensively copies a source change set supplied by an adapter.
 * The returned value is safe to retain in Store events or history.
 */
export function normalizeSourceChangeSet(
  changeSet: SourceChangeSet,
): SourceChangeSet {
  if (changeSet === null || typeof changeSet !== 'object') {
    throw new TypeError('Source change set must be an object')
  }
  if (!Array.isArray(changeSet.changes)) {
    throw new TypeError('Source change set.changes must be an array')
  }
  const normalized = createValidatedSourceChangeSet(
    changeSet.sourceLength,
    changeSet.changes,
  )
  if (normalized.targetLength !== changeSet.targetLength) {
    throw new RangeError('Source change set targetLength is inconsistent')
  }
  return normalized
}

/**
 * Creates a source change set from explicit source-offset changes. Deleted
 * segments are captured from `source`; callers never need a second source
 * authority to apply or invert the result.
 */
export function createSourceChangeSetFromChanges(
  source: string,
  changes: readonly SourceChangeSpec[],
): SourceChangeSet {
  requireString(source, 'Source')
  if (!Array.isArray(changes)) {
    throw new TypeError('Source changes must be an array')
  }

  const recorded = changes.map((change) => {
    if (change === null || typeof change !== 'object') {
      throw new TypeError('Source change specification must be an object')
    }
    requireString(change.insert, 'Source change.insert')
    requirePosition(change.from, source.length, 'Source change.from')
    requirePosition(change.to, source.length, 'Source change.to')
    if (change.to < change.from) {
      throw new RangeError('Source change.to cannot precede from')
    }
    return {
      from: change.from,
      to: change.to,
      deleted: source.slice(change.from, change.to),
      inserted: change.insert,
    }
  })

  return createValidatedSourceChangeSet(source.length, recorded)
}

/**
 * Creates a deterministic minimal contiguous replacement. Adapters that have
 * exact disjoint ranges can use createSourceChangeSetFromChanges instead.
 */
export function createSourceChangeSet(
  source: string,
  target: string,
): SourceChangeSet {
  requireString(source, 'Source')
  requireString(target, 'Target')
  if (source === target) {
    return createValidatedSourceChangeSet(source.length, [])
  }

  let prefix = 0
  const commonLength = Math.min(source.length, target.length)
  while (
    prefix < commonLength &&
    source.charCodeAt(prefix) === target.charCodeAt(prefix)
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < source.length - prefix &&
    suffix < target.length - prefix &&
    source.charCodeAt(source.length - suffix - 1) ===
      target.charCodeAt(target.length - suffix - 1)
  ) {
    suffix += 1
  }

  return createSourceChangeSetFromChanges(source, [
    {
      from: prefix,
      to: source.length - suffix,
      insert: target.slice(prefix, target.length - suffix),
    },
  ])
}

/** Applies a source change set after verifying its deleted segments. */
export function applySourceChangeSet(
  source: string,
  changeSet: SourceChangeSet,
): string {
  requireString(source, 'Source')
  const normalized = normalizeSourceChangeSet(changeSet)
  if (source.length !== normalized.sourceLength) {
    throw new RangeError(
      `Source length ${source.length} does not match change set source length ${normalized.sourceLength}`,
    )
  }

  let cursor = 0
  let result = ''
  for (const change of normalized.changes) {
    if (source.slice(change.from, change.to) !== change.deleted) {
      throw new Error(
        `Source change deleted segment does not match source at ${change.from}`,
      )
    }
    result += source.slice(cursor, change.from)
    result += change.inserted
    cursor = change.to
  }
  result += source.slice(cursor)

  if (result.length !== normalized.targetLength) {
    throw new Error('Applied source change produced an unexpected target length')
  }
  return result
}

/** Returns the exact inverse, using target-coordinate ranges. */
export function invertSourceChangeSet(
  changeSet: SourceChangeSet,
): SourceChangeSet {
  const normalized = normalizeSourceChangeSet(changeSet)
  let delta = 0
  const inverse = normalized.changes.map((change) => {
    const from = change.from + delta
    const to = from + change.inserted.length
    delta += change.inserted.length - (change.to - change.from)
    return {
      from,
      to,
      deleted: change.inserted,
      inserted: change.deleted,
    }
  })

  return createValidatedSourceChangeSet(normalized.targetLength, inverse)
}

function normalizeSourceChangeSequence(
  sequence: SourceChangeSequence,
): SourceChangeSequence {
  if (sequence === null || typeof sequence !== 'object') {
    throw new TypeError('Source change sequence must be an object')
  }
  if (!Array.isArray(sequence.changes) || sequence.changes.length === 0) {
    throw new TypeError('Source change sequence must contain changes')
  }

  const normalizedChanges = sequence.changes.map(normalizeSourceChangeSet)
  const sourceLength = normalizedChanges[0]?.sourceLength
  if (sourceLength === undefined) {
    throw new TypeError('Source change sequence must contain changes')
  }
  for (let index = 1; index < normalizedChanges.length; index += 1) {
    const previous = normalizedChanges[index - 1] as SourceChangeSet
    const current = normalizedChanges[index] as SourceChangeSet
    if (previous.targetLength !== current.sourceLength) {
      throw new RangeError(
        'Source change sequence steps do not connect at the same source length',
      )
    }
  }
  const targetLength =
    normalizedChanges[normalizedChanges.length - 1]?.targetLength
  if (targetLength === undefined) {
    throw new TypeError('Source change sequence must contain changes')
  }
  if (sequence.sourceLength !== sourceLength) {
    throw new RangeError('Source change sequence sourceLength is inconsistent')
  }
  if (sequence.targetLength !== targetLength) {
    throw new RangeError('Source change sequence targetLength is inconsistent')
  }

  return Object.freeze({
    sourceLength,
    targetLength,
    changes: Object.freeze(normalizedChanges),
  })
}

export function createSourceChangeSequence(
  changeSet: SourceChangeSet,
): SourceChangeSequence {
  const normalized = normalizeSourceChangeSet(changeSet)
  return Object.freeze({
    sourceLength: normalized.sourceLength,
    targetLength: normalized.targetLength,
    changes: Object.freeze([normalized]),
  })
}

export function appendSourceChangeSequence(
  sequence: SourceChangeSequence,
  changeSet: SourceChangeSet,
): SourceChangeSequence {
  const normalizedSequence = normalizeSourceChangeSequence(sequence)
  const normalizedChange = normalizeSourceChangeSet(changeSet)
  const last = normalizedSequence.changes[
    normalizedSequence.changes.length - 1
  ] as SourceChangeSet
  if (last.targetLength !== normalizedChange.sourceLength) {
    throw new RangeError(
      'Source change sequence steps do not connect at the same source length',
    )
  }

  const previousChanges = normalizedSequence.changes
  const previousSet = previousChanges[previousChanges.length - 1] as SourceChangeSet
  const previousChange = previousSet.changes[0]
  const nextChange = normalizedChange.changes[0]
  let nextSets: readonly SourceChangeSet[]

  // The common CM6 typing path appends at the caret immediately after the
  // preceding insertion. Compact that path into one delta so a long typing
  // run does not allocate one retained object per keystroke.
  if (
    previousSet.changes.length === 1 &&
    normalizedChange.changes.length === 1 &&
    previousChange !== undefined &&
    nextChange !== undefined &&
    nextChange.from === previousChange.from + previousChange.inserted.length &&
    nextChange.to === nextChange.from &&
    nextChange.deleted === ''
  ) {
    const compacted = createValidatedSourceChangeSet(previousSet.sourceLength, [
      {
        from: previousChange.from,
        to: previousChange.to,
        deleted: previousChange.deleted,
        inserted: previousChange.inserted + nextChange.inserted,
      },
    ])
    nextSets = Object.freeze([
      ...previousChanges.slice(0, -1),
      compacted,
    ])
  } else {
    nextSets = Object.freeze([...previousChanges, normalizedChange])
  }

  return Object.freeze({
    sourceLength: normalizedSequence.sourceLength,
    targetLength: normalizedChange.targetLength,
    changes: nextSets,
  })
}

export function applySourceChangeSequence(
  source: string,
  sequence: SourceChangeSequence,
): string {
  requireString(source, 'Source')
  const normalized = normalizeSourceChangeSequence(sequence)
  if (source.length !== normalized.sourceLength) {
    throw new RangeError(
      `Source length ${source.length} does not match sequence source length ${normalized.sourceLength}`,
    )
  }

  let current = source
  for (const changeSet of normalized.changes) {
    current = applySourceChangeSet(current, changeSet)
  }
  if (current.length !== normalized.targetLength) {
    throw new Error('Applied source sequence produced an unexpected target length')
  }
  return current
}

export function invertSourceChangeSequence(
  sequence: SourceChangeSequence,
): SourceChangeSequence {
  const normalized = normalizeSourceChangeSequence(sequence)
  const inverseSets = normalized.changes
    .slice()
    .reverse()
    .map((changeSet) => invertSourceChangeSet(changeSet))
  return Object.freeze({
    sourceLength: normalized.targetLength,
    targetLength: normalized.sourceLength,
    changes: Object.freeze(inverseSets),
  })
}

/** UTF-8 payload bytes retained by a source change set. */
export function sourceChangeSetByteSize(
  changeSet: SourceChangeSet,
): number {
  const normalized = normalizeSourceChangeSet(changeSet)
  return normalized.changes.reduce(
    (total, change) =>
      total + utf8ByteLength(change.deleted) + utf8ByteLength(change.inserted),
    0,
  )
}

export function sourceChangeSequenceByteSize(
  sequence: SourceChangeSequence,
): number {
  const normalized = normalizeSourceChangeSequence(sequence)
  return normalized.changes.reduce(
    (total, changeSet) => total + sourceChangeSetByteSize(changeSet),
    0,
  )
}

/** Counts UTF-8 bytes without depending on a browser or platform adapter. */
export function utf8ByteLength(value: string): number {
  requireString(value, 'Value')
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        // TextEncoder replaces an unpaired surrogate with U+FFFD.
        bytes += 3
      }
    } else {
      // Includes BMP characters and unpaired low surrogates, which TextEncoder
      // also represents as the three-byte replacement character.
      bytes += 3
    }
  }
  return bytes
}