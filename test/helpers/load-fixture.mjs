// Test helper: load an anonymized CapCut draft fixture by FIXTURE_MAP key.
// Each call returns a *freshly parsed* JS object so tests can mutate
// without leaking state to sibling tests.
//
// Fixtures live at <repo>/test-fixtures/fixtures/<key>.json (mirrors the
// FIXTURE_MAP keys in test-fixtures/anonymize.py).
//
// Usage:
//   import { loadFixture, FIXTURES, fixturePath } from "./helpers/load-fixture.mjs";
//   const draft = loadFixture("minimal-draft");

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "..", "..", "test-fixtures", "fixtures");

export const FIXTURES = Object.freeze({
  MINIMAL: "minimal-draft",
  KEN_BURNS: "ken-burns-draft",
  EFFECTS: "effects-draft",
  SUBTITLES: "subtitles-draft",
  FULL_PSYCHO: "full-psycho-draft",
  ANIMATIONS: "animations-draft",
  STICKERS: "stickers-draft",
  TRANSITIONS: "transitions-draft",
  MASKS_FILTERS: "masks-filters-draft",
});

export function fixturePath(key) {
  return resolve(FIXTURES_DIR, `${key}.json`);
}

export function loadFixture(key) {
  const raw = readFileSync(fixturePath(key), "utf-8");
  return JSON.parse(raw);
}

export function loadFixtureRaw(key) {
  return readFileSync(fixturePath(key), "utf-8");
}
