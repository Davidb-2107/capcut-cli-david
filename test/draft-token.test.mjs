// Unit tests for draftPlaceholderToken — the portable-path token used by
// addAudio/addVideo (v2.0.0). Discovery is two-step: (1) reuse a token already
// present in the current draft's materials; (2) fall back to the observed
// CapCut/JianYing per-install constant — NEVER the draft's own GUID
// (unresolvable), and NEVER a sibling draft's token (could be a stale broken
// draft.id token written by pre-fix code).
import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { draftPlaceholderToken } from "../dist/utils/draft-token.js";
import { loadFixture, FIXTURES } from "./helpers/load-fixture.mjs";

const INSTALL_TOKEN = "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-token-"));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
  return dir;
}

test("draftPlaceholderToken: reuses a token already present in materials.videos", () => {
  const draft = loadFixture(FIXTURES.KEN_BURNS); // fixture has tokenized video paths
  strictEqual(draftPlaceholderToken(draft), INSTALL_TOKEN);
});

test("draftPlaceholderToken: scans materials.audios too", () => {
  const draft = loadFixture(FIXTURES.MINIMAL);
  draft.materials.audios.push({ id: "x", path: `${INSTALL_TOKEN}\\Resources\\x.mp3`, name: "x.mp3" });
  strictEqual(draftPlaceholderToken(draft), INSTALL_TOKEN);
});

test("draftPlaceholderToken: ignores non-token absolute paths", () => {
  const draft = loadFixture(FIXTURES.MINIMAL);
  draft.materials.videos.push({ id: "v", path: "C:\\somewhere\\v_slug\\assets\\video\\a.mp4" });
  const token = draftPlaceholderToken(draft);
  ok(!token.includes("v_slug"));
});

test("draftPlaceholderToken: token-less draft falls back to the CapCut constant (not the draft GUID)", () => {
  const draft = loadFixture(FIXTURES.MINIMAL); // no materials at all
  const token = draftPlaceholderToken(draft);
  strictEqual(token, INSTALL_TOKEN);
  strictEqual(token.includes(draft.id), false);
});

test("draftPlaceholderToken: NEVER adopts a sibling draft's token (could be a stale broken one)", (t) => {
  // A sibling built by pre-fix code carries a broken draft.id-derived token.
  const projectsRoot = scratch(t);
  const brokenToken = "##_draftpath_placeholder_a1b2c3d4-e5f6-7890-abcd-ef0123456789_##";
  const siblingDir = join(projectsRoot, "v_old-broken-draft");
  mkdirSync(siblingDir, { recursive: true });
  writeFileSync(
    join(siblingDir, "draft_content.json"),
    JSON.stringify({ materials: { videos: [{ id: "v", path: `${brokenToken}\\Resources\\x.mp4` }] } }),
  );
  const ownDir = join(projectsRoot, "v_new-draft");
  mkdirSync(ownDir, { recursive: true });

  const draft = loadFixture(FIXTURES.MINIMAL); // token-less
  const token = draftPlaceholderToken(draft, join(ownDir, "draft_content.json"));
  strictEqual(token, INSTALL_TOKEN); // the constant — not the sibling's broken token
});
