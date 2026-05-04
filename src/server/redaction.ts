export function redactSensitiveErrorMessage(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]*\*+[A-Za-z0-9_-]*\b/g, "sk-[redacted]")
    .replace(/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{6,}\b/g, "sk-[redacted]");
}

export function redactedErrorMessage(error: unknown): string {
  return redactSensitiveErrorMessage(error instanceof Error ? error.message : String(error));
}

export function redactedError(error: unknown): Error {
  const next = new Error(redactedErrorMessage(error));
  if (error instanceof Error) {
    next.name = error.name;
  }
  return next;
}
