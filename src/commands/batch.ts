export interface BatchOp {
  cmd: string;
  id?: string;
  text?: string;
  offset?: string;
  speed?: number;
  volume?: number;
  opacity?: number;
  start?: string;
  duration?: string;
  track?: string;
}

// Coordinate JSONL operations without owning input, output or persistence.
export function runBatch(input: string, execute: (op: BatchOp) => void) {
  let succeeded = 0;
  let failed = 0;
  const errors: { error: string; line: string }[] = [];
  for (const line of input.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      execute(JSON.parse(trimmed) as BatchOp);
      succeeded++;
    } catch (e) {
      failed++;
      errors.push({ error: e instanceof Error ? e.message : String(e), line: trimmed });
    }
  }
  return { summary: { ok: failed === 0, succeeded, failed }, errors };
}
