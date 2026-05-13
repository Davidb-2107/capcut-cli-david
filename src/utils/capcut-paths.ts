import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Locate the bundled draft template that ships in the npm tarball under
// templates/minimal/. Works both for a built install (dist/utils/...) and
// for tsx dev (src/utils/...).
export function resolveTemplateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "templates", "minimal"),
    resolve(here, "..", "..", "..", "templates", "minimal"),
  ];
  for (const c of candidates) {
    if (existsSync(resolve(c, "draft_content.json"))) return c;
  }
  throw new Error("Bundled template not found. Expected templates/minimal/draft_content.json in package.");
}

// Default CapCut projects-root per platform. CapCut indexes drafts from the
// root_meta_info.json file inside this directory.
export function defaultProjectsRoot(): string {
  const home = homedir();
  if (platform() === "win32") {
    const local = process.env.LOCALAPPDATA ?? resolve(home, "AppData", "Local");
    return resolve(local, "CapCut", "User Data", "Projects", "com.lveditor.draft");
  }
  if (platform() === "darwin") {
    return resolve(home, "Movies", "CapCut", "User Data", "Projects", "com.lveditor.draft");
  }
  return resolve(home, ".local", "share", "CapCut", "User Data", "Projects", "com.lveditor.draft");
}

// Current time in microseconds since epoch — the unit CapCut uses for the
// tm_draft_* timestamp fields in draft_meta_info.json and root_meta_info.json.
export function nowUs(): number {
  return Date.now() * 1000;
}
