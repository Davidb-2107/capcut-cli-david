// Registre de capacités : validité interne + anti-dérive vs le dispatch réel de index.ts.
import { test } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPABILITIES, CHAINS } from "../dist/capabilities.js";
import { KINDS } from "../dist/commands/query.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Verbes réellement dispatchés par src/index.ts : cmd === "x" et case "x": */
function dispatchedVerbs() {
  const src = readFileSync(resolve(ROOT, "src/index.ts"), "utf-8");
  const verbs = new Set();
  for (const m of src.matchAll(/cmd === "([a-z-]+)"/g)) verbs.add(m[1]);
  for (const m of src.matchAll(/^\s*case "([a-z-]+)":/gm)) verbs.add(m[1]);
  return verbs;
}

test("anti-dérive: chaque verbe dispatché a sa carte, et réciproquement", () => {
  const dispatched = dispatchedVerbs();
  const carded = new Set(CAPABILITIES.map((c) => c.verb));
  const missingCards = [...dispatched].filter((v) => !carded.has(v));
  const ghostCards = [...carded].filter((v) => !dispatched.has(v));
  deepStrictEqual(missingCards, [], `verbes dispatchés sans carte: ${missingCards}`);
  deepStrictEqual(ghostCards, [], `cartes sans verbe dispatché: ${ghostCards}`);
});

test("registre: verbes uniques, catégories valides, champs non vides", () => {
  const cats = new Set(["creer", "peupler", "captions", "editer", "animer", "reparer", "decouvrir"]);
  const seen = new Set();
  for (const c of CAPABILITIES) {
    ok(!seen.has(c.verb), `verbe dupliqué: ${c.verb}`);
    seen.add(c.verb);
    ok(cats.has(c.category), `${c.verb}: catégorie inconnue ${c.category}`);
    ok(c.summary.length > 10, `${c.verb}: summary vide/trop court`);
    ok(c.signature.includes(c.verb), `${c.verb}: signature ne contient pas le verbe`);
    ok(c.example.startsWith("capcut-david "), `${c.verb}: example doit être une commande copiable`);
    ok(/^\d+\.\d+\.\d+$/.test(c.since), `${c.verb}: since doit être semver`);
    ok(typeof c.readOnly === "boolean" && typeof c.capcutClosed === "boolean");
  }
});

test("cohérence: un verbe read-only n'exige pas CapCut fermé", () => {
  for (const c of CAPABILITIES) {
    if (c.readOnly) strictEqual(c.capcutClosed, false, `${c.verb}: readOnly + capcutClosed incohérent`);
  }
});

test("calibration-ui est introduite dans la version actuelle du CLI", () => {
  strictEqual(CAPABILITIES.find((capability) => capability.verb === "calibration-ui")?.since, "2.7.0");
});

test("chains: chaque étape référence une carte existante", () => {
  const carded = new Set(CAPABILITIES.map((c) => c.verb));
  ok(CHAINS.length >= 3, "au moins Stickman, Repost, psycho-build");
  for (const ch of CHAINS)
    for (const s of ch.steps) ok(carded.has(s.verb), `${ch.name}: étape ${s.verb} sans carte`);
});

// La liste des kinds vit en UNE seule constante (KINDS dans query.ts) dont se
// dérivent les messages du code — mais les cartes ci-dessous restent du texte
// libre. Ce test est le verrou qui l'empêche de ré-écarter de la réalité.
test("anti-dérive kinds: chaque kind de KINDS apparaît dans les cartes query et catalogue", () => {
  strictEqual(KINDS.length, 8, "si KINDS change, les docs et ce test doivent suivre");
  for (const verb of ["query", "catalogue"]) {
    const card = CAPABILITIES.find((c) => c.verb === verb);
    ok(card, `carte ${verb} introuvable`);
    const hay = `${card.signature} ${card.summary} ${card.flags.map((f) => `${f.flag} ${f.desc}`).join(" ")}`;
    for (const k of KINDS) ok(hay.includes(k), `${verb}: kind "${k}" absent de la carte (signature/summary/flags)`);
  }
});

test("anti-dérive kinds: catalogue.ts consomme KINDS, pas une copie locale", () => {
  const src = readFileSync(resolve(ROOT, "src/commands/catalogue.ts"), "utf-8");
  ok(!/"(?:sticker|mask|animation|curve)"\]\)?;/.test(src), "copie en dur de la liste de kinds dans catalogue.ts");
  ok(/import \{[^}]*KINDS[^}]*\} from "\.\/query\.js"/.test(src), "catalogue.ts doit importer KINDS depuis query.ts");
});
