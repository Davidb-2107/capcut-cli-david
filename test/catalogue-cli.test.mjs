// Le verbe `catalogue` de bout en bout : flags, codes de sortie, écriture.
import { test } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runCli } from "./helpers/spawn-cli.mjs";
import { loadFixtureRaw } from "./helpers/load-fixture.mjs";
import { KINDS } from "../dist/commands/query.js";

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

// Le repo vit SOUS le vault : sans ce garde, ce test-ci écrirait ses fixtures
// dans le VRAI Shared/capcut-catalogue.json de l'utilisateur.
test("13e: a temp drafts root without --catalogue refuses to touch the default path", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const r = runCli(["catalogue", "--sync", "--drafts", root]);
  strictEqual(r.status, 2);
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

// --add : entrer une ressource dont on connaît l'id mais dont le draft témoin
// n'existe plus (le cas Disco/SpeedLines/CC-DerStil). Rien à moissonner.
test("19: --add crée l'entrée sans aucun draft", (t) => {
  const cat = catPath(t);
  const r = runCli(["catalogue", "--add", "7637780179456118024", "--kind", "font", "--name", "Disco", "--catalogue", cat]);
  strictEqual(r.status, 0);
  const doc = JSON.parse(readFileSync(cat, "utf-8"));
  strictEqual(doc.entries.length, 1);
  strictEqual(doc.entries[0].id, "7637780179456118024");
  strictEqual(doc.entries[0].resource_id, "7637780179456118024");
  deepStrictEqual(doc.entries[0].names, ["Disco"]);
  deepStrictEqual(doc.entries[0].witness_drafts, []);
});

// Le piège : planCatalogueMerge REMET À ZÉRO witness_drafts de toutes les entrées
// non ignorées. Un --add qui passerait par lui effacerait les témoins de tout le
// catalogue au passage.
test("20: --add ne touche pas les autres entrées", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  const before = JSON.parse(readFileSync(cat, "utf-8")).entries;
  runCli(["catalogue", "--add", "7605981975781887248", "--kind", "font", "--name", "SpeedLines", "--catalogue", cat]);
  const after = JSON.parse(readFileSync(cat, "utf-8")).entries;
  strictEqual(after.length, before.length + 1);
  for (const e of before) {
    const now = after.find((x) => x.id === e.id);
    deepStrictEqual(now.witness_drafts, e.witness_drafts, `témoins perdus sur ${e.id}`);
  }
});

test("21: --add deux fois n'ajoute pas de doublon, et une note s'accumule", (t) => {
  const cat = catPath(t);
  const args = ["catalogue", "--add", "7457793217560318481", "--kind", "font", "--name", "CC-DerStil", "--catalogue", cat];
  runCli([...args, "--note", "dropdown System"]);
  const r = runCli([...args, "--note", "absente du cache panel"]);
  strictEqual(r.status, 0);
  const doc = JSON.parse(readFileSync(cat, "utf-8"));
  strictEqual(doc.entries.length, 1);
  ok(doc.entries[0].note.includes("dropdown System"), "la première note doit survivre");
  ok(doc.entries[0].note.includes("absente du cache panel"));
});

test("22: --add sans --name ou --kind, ou avec --sync, est une erreur d'usage", (t) => {
  const cat = catPath(t);
  strictEqual(runCli(["catalogue", "--add", "123", "--kind", "font", "--catalogue", cat]).status, 1);
  strictEqual(runCli(["catalogue", "--add", "123", "--name", "X", "--catalogue", cat]).status, 1);
  strictEqual(runCli(["catalogue", "--add", "123", "--kind", "font", "--name", "X", "--sync", "--catalogue", cat]).status, 1);
  strictEqual(existsSync(cat), false, "aucune écriture sur erreur d'usage");
});

test("23: --add --dry-run n'écrit rien mais rapporte", (t) => {
  const cat = catPath(t);
  const r = runCli(["catalogue", "--add", "999", "--kind", "effect", "--name", "Truc", "--dry-run", "--catalogue", cat]);
  strictEqual(r.status, 0);
  deepStrictEqual(r.json.added, ["999"]);
  strictEqual(existsSync(cat), false);
});

test("18: listing a missing catalogue is empty and exit 0, and creates nothing", (t) => {
  const cat = catPath(t);
  const r = runCli(["catalogue", "--catalogue", cat]);
  strictEqual(r.status, 0);
  strictEqual(r.json.entries.length, 0);
  strictEqual(existsSync(cat), false);
});

// ===========================================================================
// Élargissement --kind aux familles sticker/mask/animation/curve.
// ===========================================================================

test("24: --add accepte les nouvelles familles (sticker)", (t) => {
  const cat = catPath(t);
  const r = runCli(["catalogue", "--add", "7237287015903972613", "--kind", "sticker", "--name", "Simple Artistic Circle", "--catalogue", cat]);
  strictEqual(r.status, 0);
  deepStrictEqual(r.json.added, ["7237287015903972613"]);
  const e = r.json.entries.find((x) => x.id === "7237287015903972613");
  ok(e.kinds.includes("sticker"));
  strictEqual(existsSync(cat), true);
});

test("25: --kind bogus reste une erreur d'usage", (t) => {
  const cat = catPath(t);
  strictEqual(runCli(["catalogue", "--kind", "bogus", "--catalogue", cat]).status, 1);
  strictEqual(existsSync(cat), false);
});

test("26: --sync moissonne les 4 nouvelles familles avec les anciennes", (t) => {
  const root = makeLib(t, {
    d1: "stickers-draft",
    d2: "masks-filters-draft",
    d3: "animations-draft",
    d4: "ken-burns-draft",
  });
  const cat = catPath(t);
  const r = runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  strictEqual(r.status, 0);
  const ids = new Set(r.json.entries.map((e) => e.id));
  ok(ids.has("7237287015903972613"), "sticker Simple Artistic Circle moissonné");
  ok(ids.has("7374021188315517456"), "mask Circle moissonné");
  ok(ids.has("6724916044072227332"), "animation Fade In moissonnée");
  ok(ids.has("7034098919583781377"), "curve Cubic Out moissonnée");
  const kinds = new Set(r.json.entries.flatMap((e) => e.kinds));
  for (const k of ["sticker", "mask", "animation", "curve"]) ok(kinds.has(k), `kind ${k} présent`);
});

// Le seul garde-fou contre le retour des 10 copies de la liste : les deux verbes
// doivent accepter exactement le même ensemble de kinds (exit ≠ 1 = accepté).
test("27: query et catalogue acceptent exactement les mêmes kinds", (t) => {
  const cat = catPath(t);
  for (const k of KINDS) {
    strictEqual(runCli(["catalogue", "--kind", k, "--catalogue", cat]).status, 0, `catalogue doit accepter --kind ${k}`);
    // query refuse (2) si le root manque — mais JAMAIS 1 : le kind est accepté.
    strictEqual(runCli(["query", "x", "--kind", k, "--drafts", join(tmpdir(), "capcut-kindcheck-absent-zz9")]).status, 2, `query doit accepter --kind ${k}`);
  }
  for (const k of ["bogus", ""]) {
    strictEqual(runCli(["catalogue", "--kind", k, "--catalogue", cat]).status, 1, `catalogue doit refuser --kind '${k}'`);
    strictEqual(runCli(["query", "x", "--kind", k, "--drafts", join(tmpdir(), "capcut-kindcheck-absent-zz9")]).status, 1, `query doit refuser --kind '${k}'`);
  }
});
