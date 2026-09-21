import { readFileSync, readSync } from "node:fs";
import { CliError } from "./cli.js";

/** Default cap for user-supplied files read wholesale (audit CLI-N10). */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;

/**
 * Read a user-supplied file with a hard size cap: an oversized input fails
 * fast instead of freezing the process (sync I/O) or exhausting memory when
 * this code runs in-process behind a service.
 */
export function readFileCapped(path: string, maxBytes: number = MAX_INPUT_BYTES): string {
  const text = readFileSync(path, "utf-8");
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes > maxBytes) {
    throw new CliError(`Fichier trop volumineux (${bytes} octets > plafond ${maxBytes}) : ${path}`);
  }
  return text;
}

/**
 * Read stdin with a hard size cap (audit CLI-N10: readFileSync(0) is unbounded).
 * Chunked reads so a huge payload never accumulates before the check.
 */
export function readStdinCapped(maxBytes: number = MAX_INPUT_BYTES): string {
  // Interactive stdin (TTY) would block forever waiting for a human - only
  // piped/redirected input is accepted (audit CLI-N10 follow-up).
  if (process.stdin.isTTY) {
    throw new CliError("stdin interactif non supporté : pipe un fichier ou fournis --batch @items.json");
  }
  const fd = 0;
  const CHUNK = 64 * 1024;
  const buf = Buffer.allocUnsafe(CHUNK);
  const parts: Buffer[] = [];
  let total = 0;
  for (;;) {
    let n: number;
    try {
      n = readSync(fd, buf, 0, CHUNK, null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EAGAIN") continue;
      throw e;
    }
    if (n === 0) break;
    total += n;
    if (total > maxBytes) {
      throw new CliError(`Entrée stdin trop volumineuse (> plafond ${maxBytes} octets)`);
    }
    parts.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(parts).toString("utf-8");
}
