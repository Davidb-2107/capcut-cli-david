const SENSITIVE_KEY = /(?:ELEVENLABS_API_KEY|api[_-]?key|secret|token|password|authorization)/i;
const QUOTED_ASSIGNMENT =
  /((?:ELEVENLABS_API_KEY|api[_-]?key|secret|token|password|authorization)\s*["']?\s*[:=]\s*)(["'])(.*?)\2/gi;
const UNQUOTED_ASSIGNMENT =
  /((?:ELEVENLABS_API_KEY|api[_-]?key|secret|token|password|authorization)\s*["']?\s*[:=]\s*)([^"'`\s,;}\]]+)/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactString(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(QUOTED_ASSIGNMENT, "$1$2[REDACTED]$2").replace(UNQUOTED_ASSIGNMENT, "$1[REDACTED]");
}

export function redactSensitive(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, secrets));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(item, secrets),
      ]),
    );
  }
  return value;
}
