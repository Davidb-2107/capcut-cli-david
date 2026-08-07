// Le verbe `catalogue` de bout en bout : flags, codes de sortie, écriture.
import { test } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runCli } from "./helpers/spawn-cli.mjs";
import { loadFixtureRaw } from "./helpers/load-fixture.mjs";

function makeLib(t, drafts) {
  const root = mkdtempSync(join(tmpdir(), "capcut-cat-cli-"));
  for (const [name, fixture] of Object.entries(drafts)) {
    const sub = join(root, name);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "draft_content.json"), loadFixtureRaw(fixture));
  }
  t.after(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  return root;
}

const catPath = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cat-file-"));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  return join(dir, "capcut-catalogue.json");
};

test("11: a corrupt catalogue → exit 2, file untouched on disk", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  writeFileSync(cat, "{ not json");
  const r = runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  strictEqual(r.status, 2);
  strictEqual(readFileSync(cat, "utf-8"), "{ not json", "the corrupt file must survive untouched");
  // Le tmp est suffixé par le pid : on vérifie qu'AUCUN .tmp ne traîne, pas un nom précis.
  strictEqual(
    readdirSync(dirname(cat)).filter((f) => f.endsWith(".tmp")).length,
    0,
    "no atomic-write tmp file may be left behind",
  );
});

test("12: --dry-run reports without writing", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  const r = runCli(["catalogue", "--sync", "--dry-run", "--drafts", root, "--catalogue", cat]);
  strictEqual(r.status, 0);
  ok(r.json.added.length > 0, "it must still report what it would add");
  strictEqual(existsSync(cat), false, "--dry-run writes nothing");
});

test("13a: --catalogue without a value → exit 1", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const r = runCli(["catalogue", "--drafts", root, "--catalogue"]);
  strictEqual(r.status, 1);
});

test("13b: --catalogue=<x> is refused → exit 1", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const r = runCli(["catalogue", "--drafts", root, "--catalogue=/tmp/x.json"]);
  strictEqual(r.status, 1);
});

// Un flag qui avale le flag suivant, ou qui devient un positionnel muet, change
// la CIBLE du sync sans le dire : --drafts absent retombe sur la vraie
// bibliothèque CapCut, --catalogue avalé écrirait un fichier nommé "--sync".
test("13c: a valueless or flag-swallowing --drafts/--catalogue → exit 1", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  strictEqual(runCli(["catalogue", "--catalogue", cat, "--drafts"]).status, 1);
  strictEqual(runCli(["catalogue", "--sync", "--catalogue", cat, "--drafts", "--dry-run"]).status, 1);
  strictEqual(runCli(["catalogue", "--drafts", root, "--catalogue", "--sync"]).status, 1);
  strictEqual(existsSync(cat), false);
});

test("13d: --kind '' is a usage error, not a silent no-filter", (t) => {
  const cat = catPath(t);
  strictEqual(runCli(["catalogue", "--catalogue", cat, "--kind", ""]).status, 1);
});

test("14: --kind filters the listing", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  const r = runCli(["catalogue", "--kind", "transition", "--catalogue", cat]);
  strictEqual(r.status, 0);
  ok(r.json.entries.length > 0);
  ok(r.json.entries.every((e) => e.kinds.includes("transition")));
});

test("15: a drafts root under test-fixtures/ refuses to write → exit 2", (t) => {
  const cat = catPath(t);
  const fixtures = join(process.cwd(), "test-fixtures", "fixtures");
  const r = runCli(["catalogue", "--sync", "--drafts", fixtures, "--catalogue", cat]);
  strictEqual(r.status, 2);
  strictEqual(existsSync(cat), false);
});

test("16: sync is idempotent — the second run is byte-identical and adds nothing", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  const first = runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  strictEqual(first.status, 0);
  const bytes = readFileSync(cat, "utf-8");
  const second = runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  strictEqual(second.status, 0);
  strictEqual(readFileSync(cat, "utf-8"), bytes, "a no-op sync must produce an empty git diff");
  strictEqual(second.json.added.length, 0);
});

test("17: a hand-written note survives a re-sync", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  const doc = JSON.parse(readFileSync(cat, "utf-8"));
  doc.entries[0].note = "ma note à moi";
  writeFileSync(cat, `${JSON.stringify(doc, null, 2)}\n`);
  runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  const after = JSON.parse(readFileSync(cat, "utf-8"));
  strictEqual(after.entries[0].note, "ma note à moi");
});

test("18: listing a missing catalogue is empty and exit 0, and creates nothing", (t) => {
  const cat = catPath(t);
  const r = runCli(["catalogue", "--catalogue", cat]);
  strictEqual(r.status, 0);
  strictEqual(r.json.entries.length, 0);
  strictEqual(existsSync(cat), false);
});
