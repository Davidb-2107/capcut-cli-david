import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";
import { KINDS, KINDS_LIST, KINDS_PIPE, planQuery, type QueryKind, type QueryResultItem, stripBom } from "./query.js";

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function renderHuman(results: QueryResultItem[], flags: Flags): void {
  if (flags.quiet) return;
  if (results.length === 0) {
    console.log("No matches.");
    return;
  }
  const rows = results.map((r) => ({
    kind: r.kind,
    name: r.name,
    rid: r.resource_id ?? "(none)",
    from: r.from_drafts.join(", ") + (r.kind === "font" && !r.resource_id && r.font_path ? `   ${r.font_path}` : ""),
  }));
  const wKind = Math.max(4, ...rows.map((r) => r.kind.length));
  const wName = Math.max(4, ...rows.map((r) => r.name.length));
  const wRid = Math.max(11, ...rows.map((r) => r.rid.length));
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad("KIND", wKind)}  ${pad("NAME", wName)}  ${pad("RESOURCE_ID", wRid)}  FROM_DRAFTS`);
  for (const r of rows) {
    console.log(`${pad(r.kind, wKind)}  ${pad(r.name, wName)}  ${pad(r.rid, wRid)}  ${r.from}`);
  }
}

// Returns the process exit code (0 success incl. zero matches; 2 operational).
// Usage / invalid-flag errors throw via die() → exit 1 in the top-level catch.
export function cmdQuery(positional: string[], flags: Flags): number {
  // --all = inventaire complet (terme vide → tout matche). Sinon terme requis.
  const term = flags.all ? "" : positional[1];
  if (term === undefined)
    die(`Missing search term. Usage: capcut-david query <term>|--all [--kind ${KINDS_PIPE}] [--drafts <dir>]`);
  // !== undefined, pas de test de véracité : --kind "" doit être l'erreur
  // d'usage qu'il est déjà dans catalogue, pas un filtre-vide silencieux.
  if (flags.kind !== undefined && !KINDS.includes(flags.kind as QueryKind)) {
    die(`Invalid --kind '${flags.kind}'. Expected one of: ${KINDS_LIST}.`);
  }

  const root = flags.drafts ?? defaultProjectsRoot();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`${JSON.stringify({ error: `Drafts root not found: ${root}` })}\n`);
    return 2;
  }

  const draftFolders: Array<{ name: string; file: string }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "draft_content.json");
    if (existsSync(file)) draftFolders.push({ name: entry.name, file });
  }
  if (draftFolders.length === 0) {
    out({ type: "capcut-david/query@1", results: [] }, flags);
    return 0;
  }

  const drafts: Array<{ name: string; draft: unknown }> = [];
  for (const { name, file } of draftFolders) {
    let draft: unknown;
    try {
      draft = JSON.parse(stripBom(readFileSync(file, "utf8")));
    } catch {
      continue; // skip unreadable/malformed, keep scanning
    }
    if (!rec(draft)) continue;
    drafts.push({ name, draft });
  }
  if (drafts.length === 0) {
    process.stderr.write(
      `${JSON.stringify({ error: "No readable drafts found (all draft_content.json failed to parse)." })}\n`,
    );
    return 2;
  }

  const results = planQuery(drafts, term, flags.kind);
  if (flags.human) {
    renderHuman(results, flags);
    return 0;
  }
  out({ type: "capcut-david/query@1", results }, flags);
  return 0;
}
