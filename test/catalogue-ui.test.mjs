// Cartographie HTML du catalogue : rendu, miroir best-effort, e2e via --add.
import { test } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "./helpers/spawn-cli.mjs";
import { renderCatalogueHtml, regenerateCatalogueMirror } from "../dist/ui/catalogue-ui.js";

function entry(over = {}) {
  return {
    id: "1234567890",
    kinds: ["font"],
    names: ["Rubik-Bold"],
    resource_id: "1234567890",
    effect_id: null,
    font_paths: [],
    first_seen: "2026-08-01",
    witness_drafts: ["draft-a"],
    note: "une note",
    ignored: false,
    merged_from: [],
    ...over,
  };
}

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), "capcut-vault-"));
  for (const d of ["Projects", "Shared", "cartographie"]) mkdirSync(join(root, d), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("rendu : chaque entrée est visible, les données sont échappées", () => {
  const doc = { entries: [entry(), entry({ id: "unresolved:script|<&>", names: ["<b>gras</b>"], kinds: ["curve"], resource_id: null })] };
  const html = renderCatalogueHtml(doc, "C:/catalogue.json");
  ok(html, "template résolu (dist/ui/catalogue-template.html doit exister — npm run build d'abord)");
  ok(html.includes("Rubik-Bold"), "la première entrée apparaît");
  ok(html.includes("1234567890"), "l'id apparaît");
  // L'échappement HTML des valeurs a lieu côté navigateur (esc()) — le JSON
  // injecté porte les noms en clair ; la garantie côté rendu est l'anti-breakout :
  // tout "</" des données devient "<\/" pour ne jamais fermer le <script> DATA.
  ok(html.includes("<\\/b>"), "le </ d'un nom est échappé dans le JSON injecté");
  const breakout = renderCatalogueHtml({ entries: [entry({ names: ["x</script>"] })] }, "src");
  ok(breakout && !breakout.includes("x</script>"), "un nom ne peut pas fermer le <script> DATA");
});

test("miroir : catalogue hors vault → no-op (null, rien d'écrit)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cat-novault-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cat = join(dir, "capcut-catalogue.json");
  writeFileSync(cat, JSON.stringify({ entries: [entry()] }));
  strictEqual(regenerateCatalogueMirror(cat), null);
  strictEqual(existsSync(join(dir, "capcut-cli-catalogue.html")), false);
});

test("miroir : catalogue dans un vault → capcut-cli-catalogue.html écrit", (t) => {
  const root = vault(t);
  const cat = join(root, "Shared", "capcut-catalogue.json");
  writeFileSync(cat, JSON.stringify({ entries: [entry(), entry({ id: "x2", names: ["Cubic Out"], kinds: ["curve"] })] }));
  const mirror = regenerateCatalogueMirror(cat);
  strictEqual(mirror, join(root, "cartographie", "capcut-cli-catalogue.html"));
  const html = readFileSync(mirror, "utf-8");
  ok(html.includes("Rubik-Bold") && html.includes("Cubic Out"));
});

test("miroir : catalogue corrompu → best-effort silencieux", (t) => {
  const root = vault(t);
  const cat = join(root, "Shared", "capcut-catalogue.json");
  writeFileSync(cat, "{ pas du json");
  strictEqual(regenerateCatalogueMirror(cat), null);
});

test("e2e : catalogue --add régénère le miroir du vault", (t) => {
  const root = vault(t);
  const cat = join(root, "Shared", "capcut-catalogue.json");
  const r = runCli(["catalogue", "--add", "9999", "--kind", "sticker", "--name", "Rond Rouge", "--catalogue", cat]);
  strictEqual(r.status, 0);
  const mirror = join(root, "cartographie", "capcut-cli-catalogue.html");
  ok(existsSync(mirror), "le miroir doit exister après --add");
  ok(readFileSync(mirror, "utf-8").includes("Rond Rouge"), "la nouvelle entrée y figure");
});
