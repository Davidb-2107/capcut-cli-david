// Tests for import-captions --color-cycle "#hex,#hex,..." (Neon_Psycho karaoke): each
// caption card's base color = cycle[i % n] instead of the uniform --color/#FFFFFF.
// Absent flag = byte-identical to the pre-existing uniform-color behavior.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { importCaptions } from "../dist/commands/create.js";
import { hexToRgb } from "../dist/utils/companion.js";
import { loadDraft } from "../dist/draft.js";

import { FIXTURES } from "./helpers/load-fixture.mjs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

const CARDS = [
  { text: "un", start: 0, end: 100000 },
  { text: "deux", start: 100000, end: 200000 },
  { text: "trois", start: 200000, end: 300000 },
  { text: "quatre", start: 300000, end: 400000 },
];

function segmentsOf(draftJson, trackId) {
  return draftJson.tracks.find((tr) => tr.id === trackId).segments;
}

function materialFor(draftJson, seg) {
  return draftJson.materials.texts.find((m) => m.id === seg.material_id);
}

test("importCaptions: colorCycle assigns cycle[i % n] as base text_color per card", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const cycle = ["#FF00FF", "#00FFFF"];
  const res = importCaptions(draft, filePath, { cards: CARDS, trackName: "subtitle", colorCycle: cycle });
  const segs = segmentsOf(draft, res.trackId);
  strictEqual(segs.length, 4);
  segs.forEach((seg, i) => {
    const mat = materialFor(draft, seg);
    strictEqual(mat.text_color, cycle[i % cycle.length]);
    const content = JSON.parse(mat.content);
    deepStrictEqual(content.styles[0].fill.content.solid.color, hexToRgb(cycle[i % cycle.length]));
  });
});

test("importCaptions WITHOUT colorCycle: every card keeps the uniform --color/default base color", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = loadDraft(filePath);
  const res = importCaptions(draft, filePath, { cards: CARDS, trackName: "subtitle" });
  for (const seg of segmentsOf(draft, res.trackId)) {
    const mat = materialFor(draft, seg);
    strictEqual(mat.text_color, "#FFFFFF");
  }
});

test("import-captions --color-cycle (CLI): base color alternates per card", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const jsonPath = join(dirname(filePath), "captions.json");
  writeFileSync(jsonPath, JSON.stringify(CARDS), "utf-8");
  const r = runCli([
    "import-captions",
    filePath,
    jsonPath,
    "--color-cycle",
    "#FF00FF,#00FFFF",
    "--track-name",
    "subtitle",
  ]);
  strictEqual(r.status, 0, `unexpected stderr: ${r.stderr}`);
  const after = JSON.parse(readFileSync(filePath, "utf-8"));
  const segs = segmentsOf(after, r.json.track_id);
  const cycle = ["#FF00FF", "#00FFFF"];
  segs.forEach((seg, i) => {
    const mat = materialFor(after, seg);
    strictEqual(mat.text_color, cycle[i % cycle.length]);
  });
});

test("--help advertises --color-cycle (preflight marker for orchestrator version gates)", () => {
  const r = runCli(["--help"]);
  strictEqual(r.status, 0);
  ok(r.stdout.includes("--color-cycle"), "--help must contain the --color-cycle marker");
});
