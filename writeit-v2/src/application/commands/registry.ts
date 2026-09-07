export type CommandId = string

export type CommandAvailability<Context> = (
  context: Context,
) => boolean | Promise<boolean>

export type CommandExecutor<Context, Result = void> = (
  context: Context,
) => Result | Promise<Result>

/**
 * Application-level command contract.
 *
 * Keybindings intentionally do not belong here. A command can be invoked by
 * a keybinding, a menu, a completion surface, or another application
 * command, while each invocation mechanism remains independently configured.
 */
export interface Command<Context = unknown, Result = void> {
  readonly id: CommandId
  readonly label: string
  readonly group: string
  readonly keywords: readonly string[]
  readonly availability: CommandAvailability<Context>
  readonly execute: CommandExecutor<Context, Result>
}

export class CommandValidationError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'CommandValidationError'
  }
}

export class CommandConflictError extends Error {
  readonly commandId: CommandId

  constructor(commandId: CommandId) {
    super(`Command is already registered: ${commandId}`)
    this.name = 'CommandConflictError'
    this.commandId = commandId
  }
}

export class CommandNotFoundError extends Error {
  readonly commandId: CommandId

  constructor(commandId: CommandId) {
    super(`Command is not registered: ${commandId}`)
    this.name = 'CommandNotFoundError'
    this.commandId = commandId
  }
}

export class CommandUnavailableError extends Error {
  readonly commandId: CommandId

  constructor(commandId: CommandId) {
    super(`Command is not available: ${commandId}`)
    this.name = 'CommandUnavailableError'
    this.commandId = commandId
  }
}

type RegisteredCommand<Context> = Command<Context, unknown>

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CommandValidationError(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function normalizeCommand<Context, Result>(
  command: Command<Context, Result>,
): Command<Context, Result> {
  const id = requireText(command.id, 'Command id')
  const label = requireText(command.label, `Command ${id} label`)
  const group = requireText(command.group, `Command ${id} group`)

  if (!Array.isArray(command.keywords)) {
    throw new CommandValidationError(`Command ${id} keywords must be an array`)
  }
  const keywords = command.keywords.map((keyword, index) =>
    requireText(keyword, `Command ${id} keyword at index ${index}`),
  )

  if (typeof command.availability !== 'function') {
    throw new CommandValidationError(
      `Command ${id} availability must be a function`,
    )
  }
  if (typeof command.execute !== 'function') {
    throw new CommandValidationError(`Command ${id} execute must be a function`)
  }

  return Object.freeze({
    id,
    label,
    group,
    keywords: Object.freeze(keywords),
    availability: command.availability,
    execute: command.execute,
  })
}

export type UnregisterCommand = () => void

/**
 * Stores application commands in registration order.
 *
 * The registry owns command discovery and invocation policy only. It does not
 * know about CM6, DOM, Vue, or a particular input mechanism.
 */
export class CommandRegistry<Context = unknown> {
  private readonly commands = new Map<CommandId, RegisteredCommand<Context>>()

  register<Result>(command: Command<Context, Result>): UnregisterCommand {
    if (command === null || typeof command !== 'object') {
      throw new CommandValidationError('Command must be an object')
    }

    const normalized = normalizeCommand(command)
    if (this.commands.has(normalized.id)) {
      throw new CommandConflictError(normalized.id)
    }

    this.commands.set(normalized.id, normalized as RegisteredCommand<Context>)
    let registered = true
    return () => {
      if (!registered) return
      registered = false
      if (this.commands.get(normalized.id) === normalized) {
        this.commands.delete(normalized.id)
      }
    }
  }

  has(id: CommandId): boolean {
    return this.commands.has(requireText(id, 'Command id'))
  }

  get(id: CommandId): Command<Context, unknown> | undefined {
    return this.commands.get(requireText(id, 'Command id'))
  }

  list(): readonly Command<Context, unknown>[] {
    return Object.freeze([...this.commands.values()])
  }

  async isAvailable(id: CommandId, context: Context): Promise<boolean> {
    const command = this.require(id)
    return Boolean(await command.availability(context))
  }

  async execute(id: CommandId, context: Context): Promise<unknown> {
    const command = this.require(id)
    if (!(await command.availability(context))) {
      throw new CommandUnavailableError(command.id)
    }
    return command.execute(context)
  }

  private require(id: CommandId): Command<Context, unknown> {
    const normalizedId = requireText(id, 'Command id')
    const command = this.commands.get(normalizedId)
    if (!command) throw new CommandNotFoundError(normalizedId)
    return command
  }
}
