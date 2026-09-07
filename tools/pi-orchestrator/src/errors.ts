export type PiSessionErrorCode =
  | "MODEL_NOT_AVAILABLE"
  | "MODEL_OVERRIDE_FAILED"
  | "UNSUPPORTED_THINKING_LEVEL"
  | "SESSION_NOT_FOUND"
  | "AMBIGUOUS_SESSION_ID"
  | "SESSION_OPEN_FAILED"
  | "INVALID_RESUME_CWD"
  | "PI_AGENT_ERROR"
  | "NO_ASSISTANT_RESPONSE"
  | "PI_SESSION_MAX_DEPTH_EXCEEDED"
  | "INVALID_INPUT"
  | "INTERNAL_ERROR";

export class PiSessionError extends Error {
  constructor(
    readonly code: PiSessionErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`${code}: ${message}`);
    this.name = "PiSessionError";
  }
}

export function asPiSessionError(error: unknown): PiSessionError {
  if (error instanceof PiSessionError) return error;
  return new PiSessionError("PI_AGENT_ERROR", error instanceof Error ? error.message : String(error), error);
}

export function errorCode(error: unknown): string {
  return asPiSessionError(error).code;
}
