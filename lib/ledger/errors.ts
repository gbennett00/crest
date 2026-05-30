export class LedgerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export function isLedgerError(error: unknown): error is LedgerError {
  return error instanceof LedgerError;
}
