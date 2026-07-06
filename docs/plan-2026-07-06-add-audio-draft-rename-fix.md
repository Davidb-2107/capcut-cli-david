# Plan — `add-audio` : audio introuvable après duplication/renommage du draft CapCut

**Date :** 2026-07-06 · **Statut :** ✅ CLOS — shippé **v2.0.0** (npm `latest`, 2026-07-06) ; E2E confirmé par David le jour même (`v_refuser-les-compliments` régénéré, dossier renommé sur disque, audio chargé sans dialogue « Link media »). Gate vault `require_portable_media_path` en place. · **Méthode :** workflow 6 agents (3 compréhension → plan → 2 relecteurs adverses, verdict RISQUÉ sur la 1re version) + vérification factuelle de la faisabilité du jeton audio.

---

## 1. Le bug (vérifié)

`capcut-david add-audio` copie le mp3 dans `<draft>/assets/audio/<nom>.mp3` et écrit dans `draft_content.json` un `material.path` **absolu qui contient le nom du draft** (`…\com.lveditor.draft\v_<slug>\assets\audio\narration.mp3`). Quand CapCut **duplique/renomme** le draft en `v_<slug>(1)`, ce chemin devient mort → dialogue « Link media, couldn't find narration.mp3 ». (Repro réelle 2026-07-06 sur `refuser-les-compliments`.)
Preuve code : `src/commands/create.ts::addAudio` L248-254 (copie) + L275 (`path: localPath`).

## 2. La cause + le mécanisme correct (PROUVÉS)

La 1re idée (« référencer le mp3 en place hors du draft », flag `--link`) reposait sur une prémisse **fausse** et est **abandonnée**. Faits établis :

- La vidéo (et l'audio des drafts qui marchent) ne survit PAS par référence externe : elle est **copiée dans `<draft>/Resources/<uuid>.<ext>`** et référencée par un **jeton portable** `##_draftpath_placeholder_<UUID>_##\Resources\<uuid>.<ext>` qui se re-résout relativement au draft → survit au renommage.
- **VÉRIFIÉ que le jeton marche pour l'AUDIO** (le point qui était NON VÉRIFIÉ) :
  - `niche_pc_3h17_..._parle(1)` — un draft **DUPLIQUÉ** (`(1)`) — a ses 4 materials audio (`type: extract_music`, le même type que `capcut-david`) en jeton, et les 4 `.mp3` **existent** sous son propre `…(1)\Resources\<uuid>.mp3`. Le jeton s'est re-résolu vers le nouveau dossier → **l'audio survit à la duplication**, exactement le scénario du bug.
  - Idem `repost-le-rappeur`, `la-voix-dapres-v2`, `paranoia-spiral`, `psycho-*`, etc. : audio tokenisé, fichiers présents.
  - Les SEULS drafts en chemin absolu-interne (le bug) sont ceux bâtis par `capcut-david` (`surpenser-*`, `hyper-independance`, `v_couper-les-gens(2)`, `v_refuser-les-compliments(1)`). Tous ceux bâtis par `cutcli` (Niche_PC, Repost, psycho) sont tokenisés et fonctionnent.
- Sous-dossier = **`\Resources\`** (PAS `assets/audio`), nom de fichier = un **UUID**.
- L'UUID du placeholder (`0E685133-…`) est **identique sur tous les drafts** et absent de `draft_meta_info.json` / `root_meta_info.json` → constante per-install. **Ne PAS le hardcoder** : le découvrir en scannant un jeton déjà présent dans `draft_content.json` (garanti : `videos add`/`cutcli` en écrit avant l'`add-audio`).

**Conclusion : le fix = faire écrire à `addAudio` le même jeton que `cutcli` — copie dans `Resources/` + `path` tokenisé.** C'est le mécanisme prouvé, il garde le draft self-contained, et il est robuste à la duplication.

## 3. Consommateurs de `add-audio` (3 appelants, même bug latent)

| Appelant | Fichier | État |
|---|---|---|
| Stickman montage | `Shared/montage-tools/assemble_draft.py:256` | buggé |
| **Repost_Amélioré** phase 5 | `Projects/TikTok/Repost_Amélioré/.claude/skills/5_repost-ameliore-montage/SKILL.md` (~L90, recette CLI) | buggé |
| psycho-build self-contained | `src/commands/pipeline.ts:696,708` (`addAudio(...)`) | même bug latent (`build/<slug>` renommable) |

Niche_PC n'est PAS concerné (passe par `cutcli audios add`, déjà tokenisé). Le bug est dans la fonction partagée `addAudio` → le fix en défaut répare les 3 d'un coup.

## 4. Décision de conception — **jeton = défaut** (root-cause)

Le jeton **garde la copie dans le draft** (self-contained préservé pour les 3 appelants, y compris pipeline.ts) et ne change que la forme du path. Il n'y a aucune raison de le mettre derrière un flag : il corrige les 3 appelants sans câblage ni gate moteur par-appelant, et aligne `capcut-david` sur ce que `cutcli` fait déjà.

- **Coût = rupture d'identité-octet** (la string du `path` change, et l'audio va dans `Resources/<uuid>.mp3` au lieu de `assets/audio/<nom>.mp3`) → **bump MAJEUR `2.0.0`**. Fix de bug qui change la sortie = major honnête.
- Écarté : flag `--link` externe (prémisse réfutée). Écarté : jeton derrière flag opt-in (minor) — laisse Repost/pipeline cassés sans câblage en plus, complexité pour rien puisque le jeton est strictement meilleur partout.

## 5. Changement de code — `src/commands/create.ts::addAudio` (~L246-298)

Remplacer copie-`assets/audio` + path-absolu par copie-`Resources/` + path-jeton :

```ts
// AVANT (L248-254)
const assetsDir = resolve(draftDir, "assets", "audio");
mkdirSync(assetsDir, { recursive: true });
const destPath = resolve(assetsDir, filename);
if (!existsSync(destPath)) copyFileSync(opts.path, destPath);
const localPath = destPath;

// APRÈS
const ext = extname(opts.path) || ".mp3";
const resDir = resolve(draftDir, "Resources");
mkdirSync(resDir, { recursive: true });
const destPath = resolve(resDir, `${matId}${ext}`);      // nom = material id (déterministe, per-build)
if (!existsSync(destPath)) copyFileSync(resolve(opts.path), destPath);
const token = draftPlaceholderToken(draft);              // scanne un jeton existant, sinon dérive du GUID
const localPath = `${token}\\Resources\\${matId}${ext}`; // séparateur backslash (forme prouvée Windows)
```

- **`draftPlaceholderToken(draft)`** = nouveau helper (fichier `src/utils/…`) : scanne `materials.videos[].path` / `audios[].path` pour un `##_draftpath_placeholder_<UUID>_##`, le réutilise ; si aucun (draft audio-seul), dériver du GUID du draft. Factoriser pour que `addVideo` et `pipeline.ts` l'emploient aussi (cohérence 3 appelants).
- Appliquer la même transformation à **`addVideo`** (`create.ts:339-347`) et au builder **`pipeline.ts`** (self-contained → devient rename-safe).
- `material.name` reste `filename = basename(opts.path)` (nom lisible pour l'UI), seul `path` change.
- **`validate --check-assets` : AUCUN changement.** `checkAssetsMissingFile` (`validate.ts:458`) saute déjà les paths contenant `##` (`p.includes("##")`) — un material tokenisé est correctement ignoré (le fichier est dans le draft, rien à garder externe).

## 6. Tests — `test/`

- `abspath.test.mjs` / `create.test.mjs` : la sortie change → **mettre à jour l'oracle** vers la forme jeton. Asserter : `path` commence par `##_draftpath_placeholder_`, contient `\Resources\`, finit par `${matId}.mp3` ; le fichier existe sous `Resources/` ; `assets/audio/` n'est PAS créé. (Les uuid per-build sont déjà mockés/normalisés dans les tests existants — même mécanisme pour `matId`.)
- Test anti-régression : le `path` écrit ne contient JAMAIS le nom du dossier draft (garantie anti-duplication).
- `draftPlaceholderToken` : unit — scanne un jeton existant ; fallback GUID si absent.

## 7. Confirmation de bout en bout (machine David — confirmation, plus un pari)

Le format est prouvé (§2). Cette étape confirme le dernier maillon : que `capcut-david` écrivant le jeton produit un draft que CapCut ouvre proprement, y compris après duplication. Repro **déterministe** :
1. Régénérer un épisode avec le moteur patché.
2. **Renommer sur disque** `…/com.lveditor.draft/v_<slug>` → `v_<slug>(1)` AVANT d'ouvrir CapCut (reproduit la condition exacte du bug).
3. Ouvrir `v_<slug>(1)` : l'audio se charge SANS dialogue « Link media » (attendu — c'est le comportement déjà observé sur `niche_pc_…(1)`).

## 8. Release (`RELEASE.md`, publish npm permission-gated David)

1. `npm version major` → **2.0.0**.
2. CHANGELOG `[2.0.0]` : `Fixed` audio introuvable après duplication CapCut (path auto-référentiel → jeton portable, comme `cutcli`) ; `Changed (BREAKING)` forme du `path` audio/vidéo (`Resources/` + jeton).
3. `npm run build` + checks pré-publish (CI, `npm test`, typecheck, lint, `--help`, fixtures).
4. commit + tag `v2.0.0` → `npm publish` (**David**) → push + `gh release`.
5. **Gate moteur** `Shared/montage-tools/engine.py` : plancher → 2.0.0 (le comportement correct devient requis ; un vieux moteur reproduit le bug en silence), appelé dans `assemble_draft.py`.
6. **SKILLS MAP** + mémoire `capcut-cli-david-status` + doc SKILL phase 8.
7. **Repost** : s'assurer que sa recette phase 5 utilise ≥ 2.0.0 (rien à changer dans la commande — le jeton est en défaut). Re-générer au besoin les drafts existants (régénérables, zéro migration de données).

## 9. Ordre d'exécution

**Lot autonome (code + tests, pas de publish) :** §5 (helper jeton + `addAudio` + `addVideo` + `pipeline.ts`) → §6 tests → build/test/lint verts → §8.5 gate `engine.py` + `assemble_draft.py`.

**Décisions / actions David :**
- **A.** Valider **jeton = défaut, bump MAJEUR 2.0.0** (vs flag opt-in minor — non recommandé).
- **B.** Confirmation E2E §7 (seul David ouvre CapCut) — après le code, avant publish. Faible risque (format prouvé).
- **C.** `npm publish` (permission-gated).
- **D.** MAJ SKILLS MAP + mémoire après publish ; re-générer les épisodes à rouvrir (dont `refuser-les-compliments`).

---

*Fichiers à toucher : `src/commands/create.ts`, `src/commands/pipeline.ts`, `src/utils/<helper token>.ts`, `test/*.mjs`, `CHANGELOG.md`, `package.json` (repo capcut-cli-david) ; `Shared/montage-tools/engine.py`, `Shared/montage-tools/assemble_draft.py`, recette Repost phase 5 (vault).*
*Preuves de vérification : scan des 33 drafts de la lib (jeton audio `extract_music` fonctionnel sur draft dupliqué `niche_pc_…(1)`, fichiers `Resources/*.mp3` présents) ; `validate.ts:458` saute déjà les jetons.*
