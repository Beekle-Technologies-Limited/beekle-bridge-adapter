export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string | number | boolean | null>,
  ) {
    super(message);
  }
}

export function isDuplicateKey(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: string; errno?: number; driverError?: { code?: string; errno?: number } };
  const code = candidate.driverError?.code ?? candidate.code;
  const errno = candidate.driverError?.errno ?? candidate.errno;
  return code === 'ER_DUP_ENTRY' || errno === 1062;
}
