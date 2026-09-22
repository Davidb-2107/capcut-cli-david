import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";
import { buildPreset, type PlanResult, planMakePreset } from "./make-preset.js";

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function renderHuman(plan: PlanResult, font: string, written: string | null, flags: Flags): void {
  if (flags.quiet) return;
  if (plan.status === "none") {
    console.log(`No font matching '${font}'. Apply it once in CapCut, then retry.`);
    return;
  }
  if (plan.status === "ambiguous") {
    console.log(`Ambiguous — ${plan.candidates.length} fonts match '${font}':`);
    for (const c of plan.candidates) console.log(`  ${c.title}  ${c.resource_id ?? "(no rid)"}`);
    return;
  }
  const f = plan.font;
  console.log(`${f.title}  ${f.resource_id ?? "(no rid)"}  ${f.font_path ?? ""}`);
  if (written) console.log(`Preset written to ${written}`);
  else console.log("Preset is in the JSON envelope (use --out <file> to write it).");
}

// Returns the process exit code (0 success incl. zero/ambiguous; 2 operational).
// Usage errors (missing --font) throw via die() → exit 1 in the top-level catch.
export function cmdMakePreset(flags: Flags): number {
  const font = flags.font;
  if (!font)
    die(
      "Missing --font <name|resource_id>. Usage: capcut-david make-preset --font <name|rid> [--out <file>] [--drafts <dir>]",
    );

  const root = flags.drafts ?? defaultProjectsRoot();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`${JSON.stringify({ error: `Drafts root not found: ${root}` })}\n`);
    return 2;
  }

  // Phase 1: collect folders containing draft_content.json.
  const draftFolders: Array<{ name: string; file: string }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "draft_content.json");
    if (existsSync(file)) draftFolders.push({ name: entry.name, file });
  }
  if (draftFolders.length === 0) {
    if (flags.human) renderHuman({ status: "none" }, font, null, flags);
    else
      out(
        {
          type: "capcut-david/make-preset@1",
          ok: false,
          font: null,
          ambiguous: false,
          candidates: [],
          written: null,
          preset: null,
        },
        flags,
      );
    return 0;
  }

  // Phase 2: parse each; skip malformed.
  const drafts: Array<{ name: string; draft: unknown }> = [];
  for (const { name, file } of draftFolders) {
    let draft: unknown;
    try {
      draft = JSON.parse(readFileSync(file, "utf8"));
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

  const plan = planMakePreset(drafts, font);

  if (plan.status === "none") {
    if (flags.human) renderHuman(plan, font, null, flags);
    else
      out(
        {
          type: "capcut-david/make-preset@1",
          ok: false,
          font: null,
          ambiguous: false,
          candidates: [],
          written: null,
          preset: null,
        },
        flags,
      );
    return 0;
  }
  if (plan.status === "ambiguous") {
    if (flags.human) renderHuman(plan, font, null, flags);
    else
      out(
        {
          type: "capcut-david/make-preset@1",
          ok: true,
          font: null,
          ambiguous: true,
          candidates: plan.candidates.map((c) => ({
            title: c.title,
            resource_id: c.resource_id,
            from_drafts: c.from_drafts,
          })),
          written: null,
          preset: null,
        },
        flags,
      );
    return 0;
  }

  const f = plan.font;
  if (!f.resource_id) {
    process.stderr.write(
      `${JSON.stringify({ error: `Font '${f.title}' is a local font (no resource_id); cannot build a catalogue preset. Apply a catalogue font in CapCut instead.` })}\n`,
    );
    return 2;
  }

  const preset = buildPreset(f);
  let written: string | null = null;
  if (flags.out) {
    writeFileSync(flags.out, `${JSON.stringify(preset, null, 2)}\n`, "utf8");
    written = flags.out;
  }

  if (flags.human) {
    renderHuman(plan, font, written, flags);
    return 0;
  }

  out(
    {
      type: "capcut-david/make-preset@1",
      ok: true,
      font: {
        title: f.title,
        resource_id: f.resource_id,
        font_path: f.font_path,
        source_platform: f.source_platform,
        from_drafts: f.from_drafts,
      },
      ambiguous: false,
      candidates: [],
      written,
      preset,
    },
    flags,
  );
  return 0;
}
