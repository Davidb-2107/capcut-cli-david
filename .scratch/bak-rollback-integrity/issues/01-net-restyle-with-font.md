# 01: net — restyle avec police (rendre la collision rollback détectable)

**What to build:**

Le filet de caractérisation doit exercer `restyle` avec un preset **portant une police** — le seul chemin qui
déclenche le miroir de police — et figer, dans la même capture, l'état du rollback racine (`draft_content.json.bak`)
et des jumeaux que CapCut relit.

Ce ticket ne change **aucun comportement** : il enregistre l'état actuel (rollback écrasé par le miroir) afin qu'il
devienne une signature mécanique. Toute modification ultérieure — correction du ticket 02 ou régression d'un autre
verbe — devra alors passer par une mise à jour de baseline explicitement justifiée, au lieu de passer inaperçue.

Doit être vérifiable de bout en bout : relancer le filet sur une copie temporaire d'une fixture, avec un preset de
police local, et obtenir une capture stable (deux exécutions identiques) publiée comme baseline.

**Acceptance criteria:**

- [x] Un cas de round-trip `restyle` **avec police** est capturé par le filet (stdout/stderr/exit + artefact)
- [x] La capture inclut l'identité du **rollback racine** (`draft_content.json.bak`) et la liste des jumeaux écrits
      par le miroir (`template-2.tmp`, miroirs `Timelines/…` le cas échéant)
- [x] Deux exécutions consécutives produisent une capture identique (déterminisme), y compris sur un checkout LF
- [ ] Le job CI du filet reste vert : la collision est enregistrée, pas encore corrigée — _(en attente du push + run `ubuntu-latest`)_
- [x] Aucun changement de comportement produit (aucun fichier de production modifié)

**Status:** delivered locally (CI pending push)

**Blocked by:** None (can start immediately)

**Spec:** voir `00-spec-bak-rollback-integrity.md` (ce dossier)

---

## Livraison (2026-09-23)

**Branche** `feat/arch-01-golden-restyle-with-font` · **commit** `387aaef` (parent `e3036e8`) ·
2 fichiers, +176/−16 · **non poussé**.

Résultat :

- Cas `subtitles/restyle-with-font` capturé : `code 0`, stderr vide,
  `mirrored = ["template-2.tmp","draft_content.json.bak","Timelines/<guid>/draft_content.json"]`.
- Deux nouveaux champs d'artefact : `bak_canon_sha` (identité du **rollback racine**) et `mirror_twins`
  (jumeaux du miroir, GUID replié, canonisés CRLF/LF).
- **Signature figée** : `bak_equals_original = false` et
  `bak_canon_sha == draft_canon_sha == mirror_twins["template-2.tmp"] = c4c6a9880a97e130`
  (le `.bak` racine contient le draft **nouveau**, en compact — plus aucun rollback).
- Baseline : **89 → 90** cas ; les 13 cas d'écriture existants gagnent les 2 champs, **aucun champ existant ne
  bouge** ; 76 cas lecture intacts.
- **Aucun fichier de production modifié** (`src/`, `test/`, `.github/`, `package.json` intacts).

Preuves (rejouables) : `--selftest` OK · `--check` **90/90** · `--dump` ×2 identiques ·
`npm test` **712/712** · `npm run test:coverage` **94,93 % / 98,22 %** · `npm run test:fidelity` **21/21** ·
`python test-fixtures/_final_integrity.py` **9/9** · `biome ci .` **0 finding** en checkout LF.
**Parité LF mesurée sur un runtime Linux réel** (Node v22.22.0, noyau WSL2) : `--check` **90/90** sur un
checkout LF (fixture 301 711 o, 0 CRLF) — la crainte d'une baseline Windows-only est levée.

**Reste (AC4)** : pousser la branche puis confirmer la run CI `golden-output` sur `ubuntu-latest`, et passer le
statut à `done`.

**Audit externe (2026-09-23)** : PASS local sur AC1–AC3/AC5 ; AC4 non exécuté (branche non poussée). Findings
traités et triés — voir `delivery/rapport-ticket-01-net-restyle-with-font.md`, section « Réponse à l'audit ».
