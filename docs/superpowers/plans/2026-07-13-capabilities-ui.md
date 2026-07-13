# Capabilities UI (`capcut-david ui`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un verbe `capcut-david ui` qui ouvre une page HTML unique, embarquée dans le paquet npm, cartographiant TOUTES les capacités du moteur (verbes, flags, exemples, badges) — générée au build depuis un registre typé, dérive interdite par test.

**Architecture:** `src/capabilities.ts` (registre typé, source de vérité) → compilé par tsc → `scripts/build-ui.mjs` injecte `{version, capabilities, chains}` dans `src/ui/template.html` → `dist/ui/index.html` (page autonome, zéro fetch). `capcut-david ui` résout ce fichier relativement à `dist/` et l'ouvre.

**Tech Stack:** TypeScript (repo `capcut-cli-david`), node:test contre `dist/`, vanilla HTML/CSS/JS (aucune dépendance ajoutée).

**Spec:** `docs/superpowers/specs/2026-07-13-capabilities-ui-design.md`

## Global Constraints

- Version cible : **2.2.0** (minor). Node >= 18 inchangé. AUCUNE dépendance npm ajoutée.
- Conventions repo : TDD (node:test dans `test/*.test.mjs`, imports depuis `../dist/`), `npm run build` avant `npm test`, Biome clean, branche `feat/capabilities-ui`, FF-merge master. Helper CLI existant : `test/helpers/spawn-cli.mjs` (`runCli`).
- La page est 100 % autonome : JSON inliné, pas de fonts web, pas de CDN — elle doit marcher en `file://`.
- Registre en FRANÇAIS (résumés/descriptions) ; signatures/flags recopiés du `--help` réel.
- Le dispatch réel de `src/index.ts` (2026-07-13) compte **36 verbes** : 6 en `if (cmd === "…")` — init, psycho-build, register, init-meta, query, make-preset — et 30 en `case "…":` — info, tracks, segments, texts, set-text, shift, shift-all, speed, volume, trim, opacity, export-srt, materials, segment, material, add-audio, add-video, add-text, import-captions, cut, save-template, apply-template, batch, add-keyframe, ken-burns, add-effect, restyle, validate, sync-timelines, gc. Le verbe `ui` (T3) devient le 37ᵉ.
- Release (tag + push → npm publish) = **David**, jamais l'agent.

---

### Task 1: Registre `src/capabilities.ts` + tests anti-dérive

**Files:**
- Create: `src/capabilities.ts`
- Test: `test/capabilities.test.mjs` (new)

**Interfaces:**
- Produces: `CAPABILITIES: Capability[]`, `CHAINS: Chain[]`, types `Capability`/`CapabilityFlag`/`Chain`/`CapabilityCategory` — consommés par T2 (build-ui) et T3 (rien — `ui` ne lit pas le registre au runtime).

- [ ] **Step 1: Write the failing tests** (`test/capabilities.test.mjs`, new)

```js
// Registre de capacités : validité interne + anti-dérive vs le dispatch réel de index.ts.
import { test } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPABILITIES, CHAINS } from "../dist/capabilities.js";

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

test("chains: chaque étape référence une carte existante", () => {
  const carded = new Set(CAPABILITIES.map((c) => c.verb));
  ok(CHAINS.length >= 3, "au moins Stickman, Repost, psycho-build");
  for (const ch of CHAINS)
    for (const s of ch.steps) ok(carded.has(s.verb), `${ch.name}: étape ${s.verb} sans carte`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test test/capabilities.test.mjs`
Expected: FAIL (`Cannot find module '../dist/capabilities.js'`).

- [ ] **Step 3: Write `src/capabilities.ts`**

Types exactement comme la spec (§Data model) — recopiés ici :

```ts
export type CapabilityCategory =
  | "creer" | "peupler" | "captions" | "editer" | "animer" | "reparer" | "decouvrir";

export interface CapabilityFlag {
  flag: string;
  desc: string;
  since?: string;
}

export interface Capability {
  verb: string;
  category: CapabilityCategory;
  summary: string;
  signature: string;
  flags: CapabilityFlag[];
  example: string;
  readOnly: boolean;
  capcutClosed: boolean;
  since: string;
}

export interface Chain {
  name: string;
  steps: { verb: string; note: string }[];
}

export const CATEGORY_LABELS: Record<CapabilityCategory, string> = {
  creer: "Créer",
  peupler: "Peupler",
  captions: "Captions & Styles",
  editer: "Éditer",
  animer: "Animer",
  reparer: "Réparer & Valider",
  decouvrir: "Découvrir",
};
```

Puis `CAPABILITIES` : **37 entrées** (les 36 verbes du dispatch + `ui`, qui existera en T3 — l'ajouter dès maintenant garde le test anti-dérive vert après T3 ; d'ici là il sera « ghost card » : ajoute-le en T3 seulement si tu exécutes les tâches dans l'ordre, OU ajoute la carte `ui` maintenant et attends-toi à un rouge temporaire du test anti-dérive jusqu'à T3 — choix : **ajouter la carte `ui` en T3**, registre T1 = 36 entrées).

Répartition par catégorie (décidée en spec) :
- `creer` : init, init-meta, register, psycho-build, save-template, apply-template
- `peupler` : add-video, add-audio, add-text, import-captions
- `captions` : restyle, make-preset, set-text, texts, export-srt
- `editer` : shift, shift-all, speed, volume, trim, opacity, cut, batch
- `animer` : ken-burns, add-keyframe, add-effect
- `reparer` : validate, sync-timelines, gc
- `decouvrir` : query, info, tracks, segments, materials, segment, material

Sources pour remplir chaque carte (PAS d'invention) : la sortie `capcut-david --help`
(signatures + flags — recopier), `docs/engine-explained.md` + `docs/*-explained.md`
(résumés FR), `CHANGELOG.md` (champ `since` = version d'apparition du verbe ;
en cas de doute `git log --oneline -- src/commands/<fichier>.ts` ou la première
mention dans le CHANGELOG). `readOnly=true` pour : validate (sans --fix --apply
il n'écrit pas — mais le verbe PEUT écrire avec --fix --apply : le marquer
`readOnly: false, capcutClosed: true` et le dire dans summary… NON — décision :
`validate` = readOnly:true avec un flag `--fix --apply` documenté `since 1.12.0`
et une note dans desc « écrit — CapCut fermé requis » ; le badge carte reste 🔍),
query, info, tracks, segments, texts, materials, segment, material, export-srt,
make-preset. Tous les autres écrivent → `capcutClosed: true` (garde moteur 1.7.0).

Deux entrées modèles (à suivre pour les 34 autres) :

```ts
export const CAPABILITIES: Capability[] = [
  {
    verb: "init",
    category: "creer",
    summary:
      "Crée un draft vierge depuis le template minimal (canvas 1080×1920 possible via --width/--height). N'écrit PAS draft_meta_info.json et n'indexe pas : toujours chaîner init-meta --register.",
    signature: "init <name> [--template <dir>] [--drafts <dir>] [--width <n> --height <n>]",
    flags: [
      { flag: "--width <n> --height <n>", desc: "dimensions du canvas (ensemble obligatoire)", since: "2.1.0" },
      { flag: "--template <dir>", desc: "template source (défaut : minimal embarqué)" },
      { flag: "--drafts <dir>", desc: "root de destination (défaut : root CapCut plateforme)" },
    ],
    example: "capcut-david init mon-draft --width 1080 --height 1920",
    readOnly: false,
    capcutClosed: true,
    since: "1.0.0",
  },
  {
    verb: "ken-burns",
    category: "animer",
    summary:
      "Pose un zoom Ken Burns sur UN segment : paire de keyframes scale_x/scale_y de t=0 à la fin du segment, easing cubic-out (parité CapCut prouvée).",
    signature: "ken-burns <project> <id> --from <scale> --to <scale> [--curve <c>]",
    flags: [
      { flag: "--from / --to <scale>", desc: "échelle départ/arrivée (ex. 1.0 → 1.08)" },
      { flag: "--curve <c>", desc: "courbe d'easing (défaut : ease-out)" },
    ],
    example: "capcut-david ken-burns \"<draft-dir>\" <segment-id> --from 1.0 --to 1.08",
    readOnly: false,
    capcutClosed: true,
    since: "1.3.0",
  },
  // … les 34 autres, mêmes règles, sources : --help + docs/ + CHANGELOG
];
```

`CHAINS` (3 entrées, étapes = verbes du registre) :

```ts
export const CHAINS: Chain[] = [
  {
    name: "Montage Stickman / épisode v1 (Shared/montage-tools assemble_draft.py)",
    steps: [
      { verb: "init", note: "draft 1080×1920" },
      { verb: "init-meta", note: "--register : sidecar meta + indexation CapCut" },
      { verb: "add-video", note: "--batch @video_infos.json — tous les plans, UN save" },
      { verb: "add-audio", note: "narration à 0s" },
      { verb: "add-text", note: "caption factice = support de style" },
      { verb: "restyle", note: "gabarit (CC-DerStil…) sur la factice" },
      { verb: "import-captions", note: "--clone-style --transform-y — captions finales" },
      { verb: "add-keyframe", note: "--batch : Ken Burns sur les plans image" },
      { verb: "sync-timelines", note: "réconcilie les mirrors" },
      { verb: "validate", note: "gate final avant d'ouvrir CapCut" },
    ],
  },
  {
    name: "Repost Amélioré phase 5 (b-roll sous la voix)",
    steps: [
      { verb: "init", note: "d_<slug> 1080×1920" },
      { verb: "init-meta", note: "--register" },
      { verb: "add-audio", note: "narration.mp3" },
      { verb: "import-captions", note: "captions-styled.json (jaune natif)" },
      { verb: "restyle", note: "gabarit derstil" },
      { verb: "add-video", note: "--batch @_video_infos.json — 25 clips b-roll" },
      { verb: "validate", note: "rc 0 → ouvrir CapCut" },
    ],
  },
  {
    name: "psycho-build (tout-en-un images + voix + musique + SRT)",
    steps: [{ verb: "psycho-build", note: "images + ken-burns + narration + musique + captions SRT en un verbe" }],
  },
];
```

(Vérifier le nom exact du verbe tout-en-un dans le dispatch : c'est `psycho-build` — la prose « pipeline » de certains docs désigne ce verbe.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/capabilities.test.mjs`
Expected: PASS (4 tests). Vérifier aussi `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/capabilities-ui
git add -A && git commit -m "feat(capabilities): registre typé des 36 verbes + chains — anti-dérive testé vs dispatch"
```

---

### Task 2: Template + `scripts/build-ui.mjs` + intégration build

**Files:**
- Create: `src/ui/template.html`
- Create: `scripts/build-ui.mjs`
- Modify: `package.json` (script `build`)
- Test: `test/ui-html.test.mjs` (new)

**Interfaces:**
- Consumes: `dist/capabilities.js` (T1), `package.json.version`.
- Produces: `dist/ui/index.html` autonome. Marqueur d'injection : la ligne `/*__DATA__*/` du template est remplacée par `const DATA = {…};`.

- [ ] **Step 1: Write the failing test** (`test/ui-html.test.mjs`)

```js
import { test } from "node:test";
import { ok } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = resolve(ROOT, "dist/ui/index.html");

test("dist/ui/index.html existe et contient chaque verbe + la version", async () => {
  ok(existsSync(HTML), "dist/ui/index.html manquant — build-ui.mjs pas branché ?");
  const html = readFileSync(HTML, "utf-8");
  const { CAPABILITIES } = await import("../dist/capabilities.js");
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
  ok(html.includes(`v${pkg.version}`), "version du paquet absente de la page");
  for (const c of CAPABILITIES) ok(html.includes(`"${c.verb}"`), `verbe ${c.verb} absent du HTML`);
  ok(!html.includes("/*__DATA__*/"), "marqueur d'injection non remplacé");
  ok(!/src=|href="http|url\(http/.test(html), "la page doit être autonome (aucune ressource réseau)");
});
```

- [ ] **Step 2: Run to verify it fails** — `npm run build && node --test test/ui-html.test.mjs` → FAIL (fichier manquant).

- [ ] **Step 3: Write `src/ui/template.html`** — page unique, vanilla, FR. Structure complète :

```html
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>capcut-david — carte des capacités</title>
<style>
  :root { --bg:#111418; --card:#1b2026; --tx:#e8eaed; --dim:#9aa0a6; --acc:#4dabf7;
          --ro:#37b24d; --wr:#f59f00; --warn:#e03131; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 system-ui,Segoe UI,sans-serif; background:var(--bg); color:var(--tx); }
  header { padding:20px 28px; border-bottom:1px solid #2a3038; display:flex; gap:16px; align-items:baseline; flex-wrap:wrap; }
  header h1 { margin:0; font-size:20px; } header .v { color:var(--acc); font-weight:600; }
  header .d { color:var(--dim); font-size:13px; }
  #bar { padding:14px 28px; display:flex; gap:10px; flex-wrap:wrap; position:sticky; top:0; background:var(--bg); border-bottom:1px solid #2a3038; }
  #q { flex:1; min-width:220px; padding:8px 12px; border-radius:8px; border:1px solid #2a3038; background:var(--card); color:var(--tx); }
  .cat-btn { padding:6px 12px; border-radius:16px; border:1px solid #2a3038; background:var(--card); color:var(--tx); cursor:pointer; }
  .cat-btn.on { background:var(--acc); color:#08121e; border-color:var(--acc); }
  main { padding:20px 28px; max-width:1100px; margin:0 auto; }
  h2.cat { margin:28px 0 10px; font-size:16px; color:var(--acc); text-transform:uppercase; letter-spacing:.06em; }
  .card { background:var(--card); border:1px solid #2a3038; border-radius:10px; padding:14px 16px; margin:10px 0; }
  .card h3 { margin:0 0 4px; font-size:16px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .badge { font-size:11px; padding:2px 8px; border-radius:10px; border:1px solid; }
  .b-ro { color:var(--ro); border-color:var(--ro); } .b-wr { color:var(--wr); border-color:var(--wr); }
  .b-cc { color:var(--warn); border-color:var(--warn); } .b-v { color:var(--dim); border-color:var(--dim); }
  .sig { font-family:Consolas,monospace; font-size:13px; color:var(--dim); margin:4px 0 8px; }
  table.flags { width:100%; border-collapse:collapse; font-size:13px; margin:8px 0; }
  table.flags td { padding:3px 8px 3px 0; vertical-align:top; }
  table.flags td:first-child { font-family:Consolas,monospace; white-space:nowrap; color:var(--acc); }
  .ex { display:flex; gap:8px; align-items:center; background:#0d1117; border-radius:6px; padding:8px 10px; font-family:Consolas,monospace; font-size:13px; overflow-x:auto; }
  .ex button { margin-left:auto; flex:none; cursor:pointer; border:1px solid #2a3038; background:var(--card); color:var(--tx); border-radius:6px; padding:3px 10px; }
  #chains .step { margin:4px 0 4px 16px; } #chains .step code { color:var(--acc); cursor:pointer; }
  .hidden { display:none; }
</style>
</head>
<body>
<header>
  <h1>capcut-david — carte des capacités</h1>
  <span class="v" id="ver"></span><span class="d" id="built"></span>
</header>
<div id="bar">
  <input id="q" type="search" placeholder="Rechercher un verbe, un flag, un usage… (ex : batch, zoom, police)">
  <!-- boutons catégories injectés par JS -->
</div>
<main>
  <section id="verbs"></section>
  <section id="chains"><h2 class="cat">Chaînes types</h2></section>
</main>
<script>
/*__DATA__*/
const LABELS = { creer:"Créer", peupler:"Peupler", captions:"Captions & Styles", editer:"Éditer",
                 animer:"Animer", reparer:"Réparer & Valider", decouvrir:"Découvrir" };
const ORDER = ["creer","peupler","captions","editer","animer","reparer","decouvrir"];
document.getElementById("ver").textContent = "v" + DATA.version;
document.getElementById("built").textContent = "généré le " + DATA.builtAt;

const bar = document.getElementById("bar");
const active = new Set();
for (const c of ORDER) {
  const b = document.createElement("button");
  b.className = "cat-btn"; b.textContent = LABELS[c]; b.dataset.cat = c;
  b.onclick = () => { b.classList.toggle("on"); b.classList.contains("on") ? active.add(c) : active.delete(c); render(); };
  bar.appendChild(b);
}

function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
function card(c){
  const badges = [
    c.readOnly ? '<span class="badge b-ro">🔍 lecture seule</span>' : '<span class="badge b-wr">✏️ écrit</span>',
    c.capcutClosed ? '<span class="badge b-cc">⚠️ CapCut fermé</span>' : "",
    `<span class="badge b-v">depuis ${c.since}</span>`,
  ].join(" ");
  const flags = c.flags.map(f =>
    `<tr><td>${esc(f.flag)}</td><td>${esc(f.desc)}${f.since ? ` <span class="badge b-v">${f.since}</span>` : ""}</td></tr>`).join("");
  return `<div class="card" id="verb-${c.verb}" data-cat="${c.category}"
    data-hay="${esc((c.verb+" "+c.summary+" "+c.signature+" "+c.flags.map(f=>f.flag+" "+f.desc).join(" ")).toLowerCase())}">
    <h3><code>${c.verb}</code> ${badges}</h3>
    <div class="sig">capcut-david ${esc(c.signature)}</div>
    <div>${esc(c.summary)}</div>
    ${flags ? `<table class="flags">${flags}</table>` : ""}
    <div class="ex"><span>${esc(c.example)}</span><button onclick="navigator.clipboard.writeText(${JSON.stringify(c.example).replace(/"/g,"&quot;")})">copier</button></div>
  </div>`;
}
function render(){
  const q = document.getElementById("q").value.trim().toLowerCase();
  let html = "";
  for (const cat of ORDER) {
    const cs = DATA.capabilities.filter(c => c.category === cat)
      .filter(c => !active.size || active.has(c.category))
      .filter(c => !q || (c.verb+" "+c.summary+" "+c.signature+" "+c.flags.map(f=>f.flag+" "+f.desc).join(" ")).toLowerCase().includes(q));
    if (cs.length) html += `<h2 class="cat">${LABELS[cat]}</h2>` + cs.map(card).join("");
  }
  document.getElementById("verbs").innerHTML = html || "<p>Aucun verbe ne correspond.</p>";
}
document.getElementById("q").oninput = render;
render();

const chains = document.getElementById("chains");
for (const ch of DATA.chains) {
  const div = document.createElement("div"); div.className = "card";
  div.innerHTML = `<h3>${esc(ch.name)}</h3>` + ch.steps.map((s,i) =>
    `<div class="step">${i+1}. <code onclick="document.getElementById('q').value='';active.clear();document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('on'));render();document.getElementById('verb-${s.verb}').scrollIntoView({behavior:'smooth'})">${s.verb}</code> — ${esc(s.note)}</div>`).join("");
  chains.appendChild(div);
}
</script>
</body>
</html>
```

- [ ] **Step 4: Write `scripts/build-ui.mjs`**

```js
// Injecte {version, builtAt, capabilities, chains} dans le template → dist/ui/index.html.
// Tourne APRÈS tsc (lit dist/capabilities.js). Aucune dépendance.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { CAPABILITIES, CHAINS } = await import(new URL("../dist/capabilities.js", import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));

const data = {
  version: pkg.version,
  builtAt: new Date().toISOString().slice(0, 10),
  capabilities: CAPABILITIES,
  chains: CHAINS,
};
const template = readFileSync(resolve(ROOT, "src/ui/template.html"), "utf-8");
const marker = "/*__DATA__*/";
if (!template.includes(marker)) {
  console.error("build-ui: marqueur /*__DATA__*/ absent du template");
  process.exit(1);
}
// </script> dans une string JSON casserait le parseur HTML — échapper.
const json = JSON.stringify(data).replace(/<\//g, "<\\/");
const html = template.replace(marker, `const DATA = ${json};`);
mkdirSync(resolve(ROOT, "dist/ui"), { recursive: true });
writeFileSync(resolve(ROOT, "dist/ui/index.html"), html);
console.log(`build-ui: dist/ui/index.html (${CAPABILITIES.length} verbes, v${pkg.version})`);
```

`package.json` : `"build": "tsc && node scripts/build-ui.mjs"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test test/ui-html.test.mjs test/capabilities.test.mjs`
Expected: PASS. Ouvrir une fois `dist/ui/index.html` dans un navigateur et vérifier à l'œil : recherche, filtres, boutons copier, ancres des chaînes.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): page capacités autonome générée au build (template + build-ui.mjs)"
```

---

### Task 3: Verbe `ui`

**Files:**
- Create: `src/commands/ui.ts`
- Modify: `src/index.ts` (dispatch AVANT la résolution projet/draft, à côté des `if (cmd === "init")` ; help text)
- Modify: `src/capabilities.ts` (ajouter la carte `ui` — le test anti-dérive l'exige)
- Test: `test/ui-verb.test.mjs` (new)

**Interfaces:**
- Consumes: `dist/ui/index.html` (T2).
- Produces: `capcut-david ui [--print-path]` — ouvre la page ; `--print-path` affiche le chemin absolu sans ouvrir (tests/headless).

- [ ] **Step 1: Write the failing tests** (`test/ui-verb.test.mjs`)

```js
import { test } from "node:test";
import { strictEqual, ok, match } from "node:assert";
import { existsSync } from "node:fs";
import { runCli } from "./helpers/spawn-cli.mjs";

test("ui --print-path: exit 0 + chemin existant, n'ouvre rien", async () => {
  const r = await runCli(["ui", "--print-path"]);
  strictEqual(r.code, 0, r.stderr);
  const p = r.stdout.trim();
  match(p, /index\.html$/);
  ok(existsSync(p), `chemin imprimé inexistant: ${p}`);
});

test("ui: apparaît dans --help", async () => {
  const r = await runCli(["--help"]);
  match(r.stdout, /ui\s+.*capacités|ui\s+.*capabilities/i);
});
```

- [ ] **Step 2: Run to verify they fail** — `npm run build && node --test test/ui-verb.test.mjs` → FAIL (verbe inconnu).

- [ ] **Step 3: Implement `src/commands/ui.ts`**

```ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { die } from "../utils/cli.js"; // adapter à l'export réel (die est utilisé partout dans commands/)

export function cmdUi(printPathOnly: boolean): void {
  // dist/commands/ui.js → dist/ui/index.html
  const htmlPath = fileURLToPath(new URL("../ui/index.html", import.meta.url));
  if (!existsSync(htmlPath)) die(`page capacités introuvable (${htmlPath}) — build incomplet ?`);
  if (printPathOnly) {
    console.log(htmlPath);
    return;
  }
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", htmlPath]]
      : process.platform === "darwin"
        ? ["open", [htmlPath]]
        : ["xdg-open", [htmlPath]];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  console.log(`ouvert : ${htmlPath}`);
}
```

(Adapter l'import de `die` au module réel — regarder comment `create.ts` l'importe. Pas de flag dans `parseFlags` : détecter `--print-path` dans les args positionnels du branch, ou l'ajouter à `Flags` si le pattern du repo le préfère — suivre le pattern existant des flags booléens comme `--force`.)

`src/index.ts` — dans le bloc des verbes sans draft (à côté de `cmd === "init"`) :

```ts
  if (cmd === "ui") {
    cmdUi(args.includes("--print-path"));
    return; // ou process.exit(0) selon le pattern du fichier
  }
```

Help text, section dédiée ou sous `Discover:` : `ui  [--print-path]  Ouvre la carte des capacités du moteur dans le navigateur`.

`src/capabilities.ts` — ajouter la 37ᵉ carte :

```ts
  {
    verb: "ui",
    category: "decouvrir",
    summary: "Ouvre cette carte des capacités dans le navigateur (page embarquée dans le paquet — toujours synchro avec la version installée).",
    signature: "ui [--print-path]",
    flags: [{ flag: "--print-path", desc: "affiche le chemin de la page sans l'ouvrir" }],
    example: "capcut-david ui",
    readOnly: true,
    capcutClosed: false,
    since: "2.2.0",
  },
```

- [ ] **Step 4: Run the FULL suite + lint**

Run: `npm run build && npm test && npx biome ci . && npx tsc --noEmit`
Expected: tout vert (514 tests existants + les nouveaux ; anti-dérive verte avec 37/37).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): verbe ui — ouvre la carte des capacités embarquée (--print-path pour headless)"
```

---

### Task 4: Release prep v2.2.0 (tag/push = David)

**Files:**
- Modify: `package.json` (version 2.2.0), `CHANGELOG.md`

- [ ] **Step 1: Bump + changelog** — `"version": "2.2.0"` ; section CHANGELOG au format du fichier : verbe `ui`, registre de capacités testé anti-dérive, page autonome embarquée.

- [ ] **Step 2: Full verify** — `npm run build && npm test && npx biome ci . && npx tsc --noEmit` → tout vert. Vérifier que `dist/ui/index.html` affiche bien `v2.2.0` (le build du bump régénère la page — c'est le test ui-html qui le prouve).

- [ ] **Step 3: Commit + STOP (gate David)**

```bash
git add -A && git commit -m "chore(release): v2.2.0 — verbe ui, carte des capacités embarquée"
```

Puis **s'arrêter** et remettre à David :

```bash
git checkout master && git merge --ff-only feat/capabilities-ui
git tag v2.2.0 && git push origin master --tags   # déclenche npm publish + GH release
npm i -g capcut-cli-david@latest && capcut-david ui   # vérif finale
```

- [ ] **Step 4 (post-release, même session ou suivante):** SKILLS MAP badge → v2.2.0 (via vault worktree), note mémoire de chantier.

---

## Self-Review Notes

- **Spec coverage:** registre + anti-dérive (T1), page autonome + injection build (T2), verbe `ui` + `--print-path` (T3), release 2.2.0 gated David (T4). Hors scope v1 (fonts machine, gap map) : absent du plan, conforme.
- **Points d'adaptation signalés (pas des placeholders):** import réel de `die` (lire create.ts), pattern exact du dispatch sans-draft dans index.ts (lire le bloc `cmd === "init"`), pattern flags booléens (`--force`) pour `--print-path`. Chaque point nomme le fichier-modèle à lire.
- **Contenu des 36 cartes:** transcription depuis `--help`/docs/CHANGELOG (sources nommées, invention interdite) — les 2 cartes modèles fixent le niveau de détail. Le champ `since` le plus incertain : CHANGELOG fait foi, sinon `git log` sur le fichier de commande.
- **Cohérence de types:** `Capability`/`Chain` identiques entre spec, T1 (source), T2 (test HTML) et T3 (carte ui). Marqueur `/*__DATA__*/` unique entre template (T2 step 3) et build-ui (T2 step 4) et testé (T2 step 1).
- **Piège connu baké:** `</` échappé dans le JSON inliné (sinon un `</script>` dans une desc casse la page) ; page testée « zéro ressource réseau ».
