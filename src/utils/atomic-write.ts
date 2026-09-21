import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { CliError } from "./cli.js";

/**
 * Same-directory tmp + rename: the rename is atomic on one volume, so a crash
 * mid-write can never leave a truncated target. On Windows the rename can lose
 * to a sync client or an editor holding the target - retry once, then fail
 * loudly. Never degrade to a direct (truncating) write.
 *
 * Generalised from writeCatalogueAtomic (catalogue-cli.ts) per audit CLI-M3.
 */
export function writeFileAtomic(path: string, text: string): void {
  // pid-suffixed: two concurrent runs must not write into the same tmp file.
  const tmpPath = `${path}.${process.pid}.tmp`;
  const scrub = () => {
    try {
      unlinkSync(tmpPath);
    } catch {}
  };
  writeFileSync(tmpPath, text, "utf-8");
  try {
    renameSync(tmpPath, path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") {
      scrub();
      throw e;
    }
    try {
      renameSync(tmpPath, path);
    } catch {
      scrub();
      throw new CliError(`Fichier verrouillé (${code}) : ${path}. Ferme l'application qui le détient et relance.`);
    }
  }
}
