import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The vault root is the nearest ancestor holding BOTH Projects/ and Shared/.
// Anchor-based, never a parents[N] count: a project moving one level deeper
// must not silently retarget the walk.
export function findVaultRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (isDir(join(dir, "Projects")) && isDir(join(dir, "Shared"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root reached
    dir = parent;
  }
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false; // permission denied on an ancestor must not abort the walk
  }
}

// --catalogue wins; else the vault's Shared/; else the current directory.
// The CLI is published on npm, so no vault path is ever hardcoded.
export function resolveCataloguePath(override: string | undefined, cwd: string): string {
  if (override) return resolve(override);
  const vault = findVaultRoot(cwd);
  if (vault) return join(vault, "Shared", "capcut-catalogue.json");
  return join(resolve(cwd), "capcut-catalogue.json");
}
