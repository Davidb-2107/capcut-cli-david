import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Draft } from "../draft.js";
import { type Flags, out } from "../utils/cli.js";
import type { Report } from "./validate.js";
import { reportExitCode, runValidate, type Severity } from "./validate.js";

interface Envelope extends Report {
  project: string;
  draft_file: string;
}

const SEVERITY_ORDER: Severity[] = ["error", "warning", "info"];

function renderHuman(env: Envelope): void {
  const s = env.summary;
  console.log(`validate ${env.draft_file}`);
  console.log(
    `  ${s.errors} error, ${s.warnings} warning, ${s.info} info  (${s.checks_run} checks run, ${s.checks_skipped} skipped)`,
  );
  if (env.findings.length === 0) {
    console.log("  clean - no problems found");
    return;
  }
  for (const sev of SEVERITY_ORDER) {
    const group = env.findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    console.log(`\n[${sev}]`);
    for (const f of group) {
      console.log(`  ${f.id.padEnd(26)} ${f.message}`);
    }
  }
}

/**
 * CLI entry. Read-only: never writes a byte. Returns the process exit code
 * (0/2) — a tool failure (bad path / unparseable JSON) throws a CliError that
 * the index.ts try/catch turns into exit 1, never reaching here.
 *
 * `projectInput` is the ORIGINAL argument (dir or file). findDraft collapses
 * both to the same draft_content.json, so we re-derive the dir-vs-file
 * distinction here: a bare file → draftDir null → FS meta.* checks skip.
 */
export function cmdValidate(draft: Draft, filePath: string, projectInput: string, flags: Flags): number {
  let draftDir: string | null = null;
  try {
    if (statSync(resolve(projectInput)).isDirectory()) draftDir = resolve(projectInput);
  } catch {
    draftDir = null;
  }

  const report = runValidate(draft, draftDir, {
    strict: flags.strict,
    checkAssets: flags.checkAssets,
    checkTimelines: flags.checkTimelines,
    ids: flags.ids,
    skip: flags.skip,
    projectsRoot: flags.projectsRoot,
  });

  const envelope: Envelope = {
    schema: report.schema,
    ok: report.ok,
    project: draftDir ?? dirname(filePath),
    draft_file: filePath,
    summary: report.summary,
    findings: report.findings,
  };

  if (flags.human) renderHuman(envelope);
  else out(envelope, flags);

  return reportExitCode(report);
}
