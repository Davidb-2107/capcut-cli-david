# Audit — ticket 01 (bak-rollback-integrity) — commit `387aaef`

**Date audit :** 2026-09-23
**Branche :** `feat/arch-01-golden-restyle-with-font` (locale, **non poussée**)
**Commit audité :** `387aaef749fa1306ec7a017ab5aab6dba1aac100` — `test(golden): freeze restyle-with-font root-rollback collision (ticket 01)`
**Parent :** `e3036e8` (spec + tickets du workstream)
**Rapport destiné à :** un autre LLM / agent qui reprend la suite (ticket 02 ou revue de PR).
**Périmètre du ticket :** `.scratch/bak-rollback-integrity/issues/01-net-restyle-with-font.md` + spec `00-spec-bak-rollback-integrity.md`.

---

## 1. Verdict

**PASS local sur les 5 acceptance criteria, sous réserve d'un point non exécuté :**
le commit n'est **pas poussée** → le job CI `golden-output` sur `ubuntu-latest` (AC4) n'a **jamais tourné** pour ce
code. Toute la vérification ci-dessous est **locale (Windows)**, plus une argumentation à vue de code pour LF.

| # | Acceptance criterion | Verdict | Preuve |
|---|---|---|---|
| AC1 | Cas round-trip `restyle` **avec police** capturé (stdout/stderr/exit + artefact) | **PASS** | Cas `subtitles/restyle-with-font` ajouté à `WRITE_CASES` (`scripts/golden-output.mjs:242`) ; dump live = baseline (ci-dessous) |
| AC2 | Capture inclut identité **rollback racine** + **jumeaux miroir** | **PASS** | Champs `bak_canon_sha` + `mirror_twins` dans `entry.artifact` (`golden-output.mjs:479-485`) ; baseline contient les deux |
| AC3 | Déterminisme : 2 exécutions identiques, y compris checkout LF | **PASS local / LF argumenté** | 2 × `--dump` → hash fichier identiques (`True`) ; parité LF : `--selftest` OK + JSON round-trip dans `mirrorTwins` — **non exécuté sur un vrai checkout Linux** |
| AC4 | Job CI du filet vert (collision enregistrée, pas corrigée) | **NON VÉRIFIÉ** | Branche non poussée (`git ls-remote` vide, aucune run CI pour ce SHA). Dernières runs = `master` uniquement |
| AC5 | Aucun changement de comportement (aucun fichier de production modifié) | **PASS** | `git diff 387aaef^..387aaef --name-only -- src/ test/ package.json .github/` → **vide** ; seuls `scripts/golden-output.mjs` + `test-fixtures/golden/baseline.json` |

**Recommandation :** pousser la branche et obtenue la run CI avant de dériver le ticket 01 en « done ».
Le ticket 02 (fix) est par ailleurs débloqué côté code : le filet fige bien l'état pré-fix.

---

## 2. Ce que fait le commit (2 fichiers, +176/−16)

### `scripts/golden-output.mjs` (+99/−4 approx.)

1. **`FONT_PRESET`** (`:122-146`) — preset miroir du schema CapCut-CaptionStyling portant une police
   (`font_path`, `font_resource_id`, `fonts[]`, `content_template.styles[].font`). Écrit **verbatim** dans le draft ;
   `mirrorFont` n'ouvre jamais le fichier → indépendant de la machine (pas de fonte requise sur disque).
2. **`FONT_TIMELINE_GUID`** (`:149`) — GUID **fixe** (pas aléatoire) pour que le miroir `Timelines/<guid>/` stagingué
   par `prepare()` soit déterministe.
3. **Cas `subtitles/restyle-with-font`** (`:238-256`) — `prepare()` écrit `preset.json` + stage
   `Timelines/<GUID>/draft_content.json` (copie de la fixture, comme CapCut au premier open), puis **une seule**
   commande : `restyle <fp> --preset <preset.json>`.
4. **`MIRROR_TIMELINE_TARGETS`** (`:386-392`) — `draft_content.json`, `draft_content.json.bak`, `template-2.tmp`,
   `attachment/patch/mini_draft.json`, `attachment/patch/patch.json`. Le `.bak` **racine** est volontairement exclu
   (figé séparément en `bak_canon_sha`).
5. **`mirrorTwins(dir, canon)`** (`:397-421`) — map `{"<chemin relatif canonique>": <sha16>}` des jumeaux existants ;
   clé GUID repliée en `Timelines/<GUID>/…` ; contenu hashé **après** `JSON.parse→stringify` + `normalizeText` +
   `canon` → identique CRLF/LF. Skip-if-absent (fichier non présent = non listé, pliable en `null` si non-JSON).
6. **`entry.artifact` enrichi** (`:472-486`) :
   - `bak_canon_sha` — identité canonique du rollback racine ;
   - `mirror_twins` — les cibles que CapCut relit ;
   - `bak_equals_original` refactoré (`bakRaw === null ? null : bakRaw === originalBytes`, sémantique inchangée).

### `test-fixtures/golden/baseline.json`

- **+1 entrée :** `subtitles/restyle-with-font` (90 cas, avant 89).
- **13 entrées existantes** enrichies des 2 nouveaux champs (`bak_canon_sha`, `mirror_twins`) — régénération mécanique.

---

## 3. La collision, figée mécaniquement

Entrée baseline `subtitles/restyle-with-font` :

```
code : 0
out  : {"ok":true,"materials_patched":28,"segments_patched":28,
        "mirrored":["template-2.tmp","draft_content.json.bak","Timelines/<UUID#1>/draft_content.json"]}
artifact:
  draft_canon_sha   : c4c6a9880a97e130
  bak_exists        : true
  bak_equals_original: false          <-- rollback détruit
  bak_canon_sha     : c4c6a9880a97e130  <-- == draft_canon_sha : le .bak contient le draft NOUVEAU
  indent_preserved  : true
  single_line       : false
  mirror_twins:
    template-2.tmp                  : c4c6a9880a97e130   (== draft, miroir rafraîchi ✓)
    Timelines/<GUID>/draft_content.json : 7a6675062b09288d
```

**Signature de la collision (ce que le ticket 02 devra faire bouger) :**
`bak_canon_sha == draft_canon_sha` et `bak_equals_original == false`.
**Après ticket 02 :** `bak_canon_sha` doit valoir le sha du draft **pré-édit** (indent d'origine),
`bak_equals_original` repasse à `true`, **le reste de la capture ne doit pas bouger** (AC ticket 02).

Invariants de contrôle (tous `true` et stables) : `out.sha = eca20bcd1d63f740`, `err = e3b0c44298fc1c14` (stderr vide),
`indent_preserved = true`.

---

## 4. Preuves exécutées (rejouables)

```bash
npm run build                                  # tsc + ui OK
node scripts/golden-output.mjs --selftest      # OK (win/linux forms canonicalise identically)
node scripts/golden-output.mjs --check         # golden: OK — 90 cases identical to baseline.
npm test                                       # 712/712 pass, 0 fail
npm run test:fidelity                          # 21 verbs swept, 0 unexpected result(s)
```

**Déterminisme (AC3, local) :**

```bash
node scripts/golden-output.mjs --dump subtitles/restyle-with-font > run1.json   # ×2
(Get-FileHash run1.json).Hash -eq (Get-FileHash run2.json).Hash                 # → True
```

**Régénération identique (baseline non éditée à la main) :**
`--write` puis `git diff` sur `baseline.json` → **aucune différence** (le fichier committé est exactement ce que
produit `--write` ; format `JSON.stringify(manifest, null, 1)`). Puis restauration (nettoyé, worktree propre).

**Aucune dérive des entrées existantes (script python, comparaison champ par champ `387aaef^` vs worktree) :**

```
new entries: {'subtitles/restyle-with-font'}
NO-DRIFT
```

Seuls les 2 champs **ajoutés** diffèrent sur les 89 entrées anciennes ; aucune valeur pré-existante n'a bougé
(donc pas de re-record silencieux de fidélité — risque type audit F10/F5 du chantier ARCH absent ici).

**Propreto :** `git status` → seulement 2 untracked pré-existants hors ticket
(`.scratch-walkup.sh`, `.scratch/arch-workstream/audit-ticket02-handoff.md`).

---

## 5. Risques / résidus (à lire avant de generaliser)

1. **AC4 non exécuté (bloquant pour « done »).** Branche locale uniquement. Pousser puis vérifier :
   `gh run list --branch feat/arch-01-golden-restyle-with-font`. Le job `golden-output` tourne sur
   `ubuntu-latest` (`.github/workflows/ci.yml:141`) avec `--selftest` + `--check` + `test:fidelity`.
2. **Parité LF argumentée, pas mesurée.** Appuis : `--selftest` OK ; `mirrorTwins` hash après `JSON.parse→stringify`
   (CRLF éliminé par construction) ; GUID replié `<GUID>` ; tmp replié via `normalizeText` (correctif audit F1 déjà en
   place, `golden-output.mjs:290-324`) ; `FONT_PRESET` ne contient aucun chemin machine (le `C:/fonts/…` est écrit
   verbatim dans le draft, pas résolu). **Reste un risque** : un écart win/linux non couvert par le selftest ferait
   échouer CI au premier push — dans ce cas, c'est une divergence de baseline à justifier, pas un bug du ticket 01.
3. **`npm run lint` échoue localement — hors périmètre.** Cause : `biome ci .` remonte un **nested root
   configuration** dans `.kilo/worktrees/glowing-cowbell/biome.json` (worktree tiers non versionné, exclu via
   `.git/info/exclude`). Rejouable à l'identique sur le parent `e3036e8` → **préexistant, non introduit par
   `387aaef`**. Un checkout CI propre n'a pas ce dossier ; à confirmer à la poussée.
4. **`fidelity-sweep` n'exerce toujours pas `restyle` avec police** (`scripts/fidelity-sweep.mjs:87-88` preset sans
   fonte) — **volontaire** : le ticket 01 ne couvre que le filet golden. Le ticket 02 exige en plus un **test de
   comportement qui échoue sans le fix** (AC6) — à ne pas confondre avec la baseline.
5. **`mirror_twins` est skip-if-absent.** Si une cible (`attachment/patch/*`, `.bak` de miroir) n'existe pas au
   moment du capture, elle n'apparaît pas dans la map — la baseline ne prouve pas l'**absence** d'une écriture future
   sur une cible non staginguée. Le staging actuel ne couvre que `Timelines/<guid>/draft_content.json` + racine
   `template-2.tmp` (les autres cibles racine ne sont pas stageées par `prepare()`).
6. **`Timelines/<GUID>/draft_content.json` = `7a6675062b09288d` ≠ sha draft racine** : le jumeau de miroir n'est pas
   un simple clone du draft racine (contenu différent après `mirrorFont`) — comportement actuel figé tel quel,
   ticket 02 ne doit pas le changer non plus (AC : « cibles CapCut toujours rafraîchies, parité inchangée »).
7. **Ticket 01 ne touche aucune commande/verbe** — toute divergence de stdout/stderr/exit constatée plus tard sur un
   autre commit n'est pas imputable à ce diff (AC5 vérifié par absence de diff sur `src/`, `test/`, CI).

---

## 6. Passerelle vers le ticket 02

`02-restyle-font-preserves-root-rollback.md` (blocked by 01 — **désormais débloqué**).

Point d'entrée de la collision constaté par l'audit ARCH précédent (à re-vérifier avant fix) :
`src/utils/mirror.ts:156-157` réécrit `draft_content.json.bak` juste après `persistDraft`
(`src/commands/restyle.ts:148/156`) — seul call site `mirrorFont` après `persistDraft`.

Définition de « terminé » pour 02, telle que la baseline la rendra mesurable :

| Champ baseline `subtitles/restyle-with-font` | Avant fix (387aaef) | Après fix attendu |
|---|---|---|
| `bak_equals_original` | `false` | `true` |
| `bak_canon_sha` | `c4c6a9880a97e130` (= draft) | sha du draft **pré-édit** (indent d'origine) |
| `draft_canon_sha`, `out.sha`, `mirror_twins.*` | inchangés | **inchangés** |
| baseline régénérée | — | **dans le même diff**, avec justification (contrat `golden-output.mjs:18-21`) |

Plus : test de comportement CLI réel qui échoue sans le fix (AC6), `restyle` sans police intact, suite verte,
coverage ≥80 %, CI verte.

---

## 7. Commandes de re-vérification rapide

```bash
git show 387aaef --stat
node scripts/golden-output.mjs --selftest && node scripts/golden-output.mjs --check
node scripts/golden-output.mjs --dump subtitles/restyle-with-font
npm test && npm run test:fidelity
git diff 387aaef^..387aaef --name-only -- src/ test/ package.json .github/   # doit être vide
gh run list --branch feat/arch-01-golden-restyle-with-font                    # après poussée
```
