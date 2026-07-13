# Capabilities UI (`capcut-david ui`) — Design

**Date:** 2026-07-13 · **Target version:** 2.2.0 (minor)

## Goal

Une carte visuelle, navigable et **toujours vraie** de tout ce que le moteur sait
faire — pour que David sache ce qu'il peut demander et repère ce qui manque.
Ouverte par un verbe intégré : `capcut-david ui`. Statique, moteur seul (pas de
données machine en v1).

## Decisions (brainstorm 2026-07-13)

- Usage principal : **carte complète des capacités moteur** (pas le catalogue
  fonts rendu, pas la gap map — hors scope v1, tracés ci-dessous).
- Fraîcheur : **générée depuis le moteur** à chaque build, dérive interdite par test.
- Accès : **verbe `ui`** — la page vit dans le paquet npm ; version affichée = binaire installé.
- Contenu : **statique, page unique autonome** (JSON inliné, `file://`, zéro serveur).

## Architecture

```
src/capabilities.ts      registre typé (source de vérité, revu en PR comme du code)
        │  npm run build
        ▼
scripts/build-ui.mjs     injecte le JSON + version package dans le template
        │
        ▼
dist/ui/index.html       page unique autonome (vanilla HTML/CSS/JS inline)
        ▲
capcut-david ui          résout le chemin dans le paquet installé et l'ouvre
```

## Data model — `src/capabilities.ts`

```ts
export type CapabilityCategory =
  | "creer" | "peupler" | "captions" | "animer" | "reparer" | "decouvrir";

export interface CapabilityFlag {
  flag: string;          // "--batch @items.json"
  desc: string;          // FR, une ligne
  since?: string;        // version d'apparition si notable ("2.1.0")
}

export interface Capability {
  verb: string;          // "add-video" — DOIT matcher le dispatch de index.ts
  category: CapabilityCategory;
  summary: string;       // FR, 1-2 phrases : à quoi ça sert
  signature: string;     // ligne d'usage, reprise du --help
  flags: CapabilityFlag[];
  example: string;       // commande copiable réaliste
  readOnly: boolean;     // true = n'écrit rien (lançable CapCut ouvert)
  capcutClosed: boolean; // true = refuse si CapCut ouvert (garde 1.7.0)
  since: string;         // version d'apparition du verbe
}

export const CAPABILITIES: Capability[];

export interface Chain {           // section éditoriale « chaînes types »
  name: string;                    // "Montage Stickman (assemble_draft)"
  steps: { verb: string; note: string }[];
}
export const CHAINS: Chain[];      // Stickman, Repost phase 5, psycho-build (pipeline)
```

Catégories (ordre d'affichage) : Créer (init, init-meta, register, pipeline) ·
Peupler (add-video, add-audio, add-text, import-captions, import-srt…) ·
Captions/Styles (restyle, make-preset, gabarits → pointe vers query) ·
Animer (ken-burns, add-keyframe, animations) · Réparer/Valider (validate,
validate --fix, sync-timelines, gc) · Découvrir (query, tracks, info, ui lui-même).
La liste exacte des verbes vient du dispatch réel de `index.ts` au moment de
l'implémentation — le test anti-dérive (ci-dessous) fait foi, pas cette prose.

## Page — `dist/ui/index.html`

- **Une seule page**, aucun framework, aucun fetch : `<script>` inline avec
  `const DATA = {version, capabilities, chains}` injecté au build.
- En-tête : nom + **version du paquet** + date de build.
- Barre : recherche plein-texte (verbe, résumé, flags) + filtres par catégorie.
- Une **carte par verbe** : signature, badges (`since`, 🔍 read-only / ✏️ écrit,
  ⚠️ CapCut fermé), tableau des flags, exemple avec bouton copier.
- Section **Chaînes types** : les enchaînements réels (Stickman, Repost, pipeline)
  avec chaque étape cliquable vers sa carte.
- FR, sobre, lisible ; pas de dépendance réseau (fonts système).

## Verbe `ui`

- Dispatch spécial dans `index.ts` AVANT toute résolution de projet/draft
  (comme `--help`) : `capcut-david ui` ne prend aucun argument draft.
- Résolution : `new URL("../ui/index.html", import.meta.url)` depuis `dist/` →
  marche pour l'install npm ET le repo local.
- Ouverture : win32 `start "" <path>` (via `cmd /c`), darwin `open`, sinon
  `xdg-open`. Flag `--print-path` : affiche le chemin sans ouvrir (utilisé par
  les tests et les environnements headless).
- Fichier absent (build incomplet) → `die` avec message clair.

## Build

- `scripts/build-ui.mjs` : lit `dist/capabilities.js` (le registre compilé),
  `package.json` (version), `src/ui/template.html` → écrit `dist/ui/index.html`.
- Branché dans `npm run build` (après tsc). `package.json.files` couvre déjà `dist/`.

## Tests (node:test, conventions du repo)

1. **Anti-dérive registre ↔ dispatch** : extraire la liste des `cmd === "…"` de
   `src/index.ts` (ou de la table de dispatch si elle existe) et asserter
   bijection avec `CAPABILITIES[].verb` (whitelist explicite pour les alias).
   Un verbe ajouté sans carte = suite rouge.
2. **HTML complet** : `dist/ui/index.html` contient chaque verbe du registre +
   la version du paquet.
3. **CLI `ui`** : `capcut-david ui --print-path` → exit 0, chemin existant ;
   pas d'ouverture navigateur en test.
4. Registre : unicité des `verb`, catégories valides, `example` non vide.

## Out of scope v1 (tracé, ne pas construire)

- Onglet « ma machine » : fonts réelles rendues (.ttf du cache CapCut), gabarits,
  drafts — nécessite un serveur local (`ui --serve` possible en v2).
- Gap map CapCut-vs-moteur (backlog features) — pourrait devenir une section
  éditoriale ultérieure du registre.
- Génération du `--help` depuis le registre (dédup possible plus tard).

## Release

v2.2.0 : bump + CHANGELOG, FF-merge master, tag + push = **David** (déclenche
npm publish + GitHub release via le workflow existant).
