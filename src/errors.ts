export type ErrorCode =
  | 'usage'
  | 'invalid_session_id'
  | 'invalid_name'
  | 'ambiguous'
  | 'store_corrupt'
  | 'internal'
  | 'cwd_missing'
  | 'session_missing'
  | 'not_found'
  | 'duplicate_session'
  | 'duplicate_name'
  | 'claude_not_found';

const EXIT_CODES: Record<ErrorCode, number> = {
  usage: 2,
  invalid_session_id: 2,
  invalid_name: 2,
  ambiguous: 2,
  store_corrupt: 1,
  internal: 1,
  cwd_missing: 3,
  session_missing: 4,
  not_found: 5,
  duplicate_session: 6,
  duplicate_name: 6,
  claude_not_found: 127,
};

export class CbmError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}
