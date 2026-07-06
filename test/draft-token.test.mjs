// Unit tests for draftPlaceholderToken — the portable-path token used by
// addAudio/addVideo (v2.0.0). The placeholder UUID is a per-install constant
// absent from draft_meta/root_meta, so it must be DISCOVERED by scanning a
// token already present in the draft, never hardcoded; fallback = draft GUID.
import { test } from "node:test";
import { strictEqual, ok } from "node:assert";

import { draftPlaceholderToken } from "../dist/utils/draft-token.js";
import { loadFixture, FIXTURES } from "./helpers/load-fixture.mjs";

const INSTALL_TOKEN = "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##";

test("draftPlaceholderToken: reuses a token already present in materials.videos", () => {
  const draft = loadFixture(FIXTURES.KEN_BURNS); // fixture has tokenized video paths
  strictEqual(draftPlaceholderToken(draft), INSTALL_TOKEN);
});

test("draftPlaceholderToken: scans materials.audios too", () => {
  const draft = loadFixture(FIXTURES.MINIMAL);
  draft.materials.audios.push({ id: "x", path: `${INSTALL_TOKEN}\\Resources\\x.mp3`, name: "x.mp3" });
  strictEqual(draftPlaceholderToken(draft), INSTALL_TOKEN);
});

test("draftPlaceholderToken: token-less draft falls back to the draft GUID", () => {
  const draft = loadFixture(FIXTURES.MINIMAL); // no materials at all
  const token = draftPlaceholderToken(draft);
  strictEqual(token, `##_draftpath_placeholder_${draft.id}_##`);
  ok(/^##_draftpath_placeholder_[0-9A-Fa-f-]+_##$/.test(token));
});

test("draftPlaceholderToken: ignores non-token absolute paths", () => {
  const draft = loadFixture(FIXTURES.MINIMAL);
  draft.materials.videos.push({ id: "v", path: "C:\\somewhere\\v_slug\\assets\\video\\a.mp4" });
  strictEqual(draftPlaceholderToken(draft), `##_draftpath_placeholder_${draft.id}_##`);
});
