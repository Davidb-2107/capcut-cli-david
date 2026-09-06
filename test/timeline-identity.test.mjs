import { test } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { saveDraft } from "../dist/draft.js";
import { syncTimelines } from "../dist/commands/sync-timelines.js";
import { runValidate } from "../dist/commands/validate.js";

const OLD_ID = "a4833895-a7d2-4a33-ad37-3c467c1f9092";
const NEW_ID = "55f138fc-d97a-41a5-a3af-56a8e8598412";

function makeDraftDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-timeline-identity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seedCopiedDraft(dir) {
  const draft = {
    id: NEW_ID,
    name: "copied-draft",
    duration: 5000000,
    fps: 30,
    canvas_config: { width: 1080, height: 1920, ratio: "9:16" },
    tracks: [],
    materials: { videos: [], audios: [], texts: [] },
  };
  const filePath = join(dir, "draft_content.json");
  writeFileSync(filePath, JSON.stringify(draft), "utf-8");

  const timelineDir = join(dir, "Timelines", OLD_ID);
  mkdirSync(join(timelineDir, "attachment", "patch"), { recursive: true });
  writeFileSync(join(timelineDir, "draft_content.json"), JSON.stringify({ ...draft, id: OLD_ID }), "utf-8");
  writeFileSync(
    join(dir, "Timelines", "project.json"),
    JSON.stringify({ id: OLD_ID, main_timeline_id: OLD_ID, timelines: [{ id: OLD_ID }] }),
    "utf-8",
  );
  writeFileSync(join(dir, "timeline_layout.json"), JSON.stringify({ timeline_id: OLD_ID }), "utf-8");
  writeFileSync(
    join(timelineDir, "attachment", "patch", "mini_draft.json"),
    JSON.stringify({ draft_id: OLD_ID, timeline_id: OLD_ID }),
    "utf-8",
  );
  return { draft, filePath, timelineDir };
}

test("saveDraft normalizes a copied CapCut timeline before the draft is opened", (t) => {
  const dir = makeDraftDir(t);
  const { draft, filePath, timelineDir } = seedCopiedDraft(dir);

  saveDraft(filePath, draft);

  const newTimelineDir = join(dir, "Timelines", NEW_ID);
  ok(existsSync(newTimelineDir), "timeline directory must follow draft_content.id");
  strictEqual(existsSync(timelineDir), false, "stale timeline directory must not remain active");
  const project = JSON.parse(readFileSync(join(dir, "Timelines", "project.json"), "utf-8"));
  deepStrictEqual(project, { id: NEW_ID, main_timeline_id: NEW_ID, timelines: [{ id: NEW_ID }] });
  strictEqual(JSON.parse(readFileSync(join(dir, "timeline_layout.json"), "utf-8")).timeline_id, NEW_ID);
  strictEqual(
    JSON.parse(readFileSync(join(newTimelineDir, "attachment", "patch", "mini_draft.json"), "utf-8")).draft_id,
    NEW_ID,
  );
  strictEqual(
    readFileSync(join(newTimelineDir, "draft_content.json"), "utf-8"),
    readFileSync(filePath, "utf-8"),
    "the first-open mirror must be the final root draft",
  );
});

test("validate reports a copied timeline whose live identity does not match the root draft", (t) => {
  const dir = makeDraftDir(t);
  const { draft } = seedCopiedDraft(dir);

  const report = runValidate(draft, dir, { checkTimelines: true });
  const finding = report.findings.find((item) => item.id === "timelines.identity");
  ok(finding, "validate must report the timeline identity mismatch");
  strictEqual(finding.severity, "error");
  strictEqual(finding.fixable, true);
});

test("syncTimelines repairs a copied timeline identity before syncing its first-open mirror", (t) => {
  const dir = makeDraftDir(t);
  const { draft, filePath } = seedCopiedDraft(dir);

  syncTimelines(filePath);

  const newTimelineDir = join(dir, "Timelines", NEW_ID);
  ok(existsSync(newTimelineDir));
  strictEqual(existsSync(join(dir, "Timelines", OLD_ID)), false);
  strictEqual(
    readFileSync(join(newTimelineDir, "draft_content.json"), "utf-8"),
    readFileSync(filePath, "utf-8"),
  );
  const project = JSON.parse(readFileSync(join(dir, "Timelines", "project.json"), "utf-8"));
  strictEqual(project.main_timeline_id, NEW_ID);
  strictEqual(project.timelines[0].id, NEW_ID);
  strictEqual(draft.id, NEW_ID);
});
