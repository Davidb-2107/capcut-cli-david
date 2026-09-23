# Audit — ticket 02 : restyle avec police préserve le rollback racine

**Destinataire :** un LLM externe (relecture / reprise de travail). Ce document est autonome — aucune conversation préalable n'est requise.
**Date :** 2026-09-23
**Méthode :** revue deux axes en parallèle (Standards / Spec), agrégée sans reranking — conformément au skill `code-review`.

## Contexte

- **Repo :** `C:\Users\dbele\src\capcut-cli-david`
- **Base :** `master @ c2d2710` (`c2d2710264deab2544994e2da0e253f28c9abef3`)
- **Commits audités** (`git diff c2d2710...HEAD`) :
  - `2b1594f` fix(mirror): preserve root draft_content.json.bak rollback in font restyle (ticket 02)
  - `ac36c1a` docs(tracker): ticket 02 done - font restyle preserves root rollback
- **Diff :** 6 fichiers, +189/−27
  - `.scratch/bak-rollback-integrity/issues/02-restyle-font-preserves-root-rollback.md`
  - `CHANGELOG.md`
  - `src/utils/mirror.ts`
  - `test-fixtures/golden/baseline.json`
  - `test/mirror.test.mjs`
  - `test/restyle.test.mjs`
- **Spec :** `.scratch/bak-rollback-integrity/issues/02-restyle-font-preserves-root-rollback.md` (issue) + `.scratch/bak-rollback-integrity/issues/00-spec-bak-rollback-integrity.md` (spec parente)
- **Standards consultés :** `CONTEXT.md`, `AGENTS.md`, `docs/agents/domain.md`, `docs/agents/issue-tracker.md`, `docs/adr/` (pas de `CODING_STANDARDS.md` / `CONTRIBUTING.md` dans ce repo) + baseline de smells Fowler (ch. 3).

**Direction implémentée (celle de la spec) :** le rollback gagne sur le fichier racine. `mirrorFont` ne réécrit plus `draft_content.json.bak` ; il continue de rafraîchir `template-2.tmp` et les miroirs `Timelines/<guid>/*`. Le `.bak` racine reste les octets d'avant édition, écrits par `persistDraft` avec l'indent d'origine.

---

## Axes séparés (ne pas fusionner ni reranker)

Les deux axes sont délibérés séparés : un changement peut passer l'un et échouer à l'autre. Ne pas établir de vainqueur unique entre axes.

## Standards

**Violations dures documentées : aucune.**

### Tensions / judgement calls documentés

1. **`AGENTS.md:5` vs `docs/agents/issue-tracker.md:3`** — AGENTS.md dit que les issues vivent sur GitHub Issues via `gh` ; `issue-tracker.md` (la source que AGENTS.md désigne) dit `.scratch/<feature>/issues/`. Le diff met à jour le ticket local, donc suit la source citée — mais le conflit entre les deux docs est désormais exercé par ce changement. Un des deux docs est stale.
2. **ADR 0002 §DoD** (`docs/adr/0002-arch-workstream.md:7`) : « contrats JSON de sortie identiques au golden-output ». `test-fixtures/golden/baseline.json` change `out.text` (`mirrored` perd `draft_content.json.bak`) — changement de contrat stdout observable. Sanctionné par l'AC4 du ticket (« baseline mise à jour dans le même diff, avec la justification »), donc la spec prime ; pas une breach, mais à surface car le DoD de l'ADR 0002 se lit absolu.
3. **Glossaire `CONTEXT.md:11`** — « Mirror (timeline mirror) » : une copie sous `Timelines/<guid>/`. Le nouveau commentaire dans `src/utils/mirror.ts:155` appelle `template-2.tmp` « Runtime mirror of the primary draft » — hors définition du glossaire. Naming préexistant, mais le diff réécrit exactement cette ligne et perpétue la dérive (`docs/agents/domain.md:43` : ne pas dériver du glossaire). Par ailleurs « rollback » est un terme porteur, nouveau, absent de `CONTEXT.md` — lacune de glossaire selon `domain.md:45`.
4. Conventions tracker (statut `done`, ligne Blocked-by, `NN-slug.md`) et Keep-a-Changelog (`#### Fixed`) — conformes.

### Smells de la baseline (tous judgement calls)

- **Duplicated Code** — `test/restyle.test.mjs` : les deux nouveaux tests répètent le shape `tmpDraft → originalBytes = readFileSync(...) → runCli → strictEqual(bakBytes, originalBytes)`. → extraire un helper (`restyleTmp(preset)` retournant `{r, originalBytes, dir}`).
- **Duplicated Code** (risque de doc drift) — la même rationale d'exclusion du `.bak` racine est écrite trois fois dans ce diff : `src/utils/mirror.ts:156-161`, `test/mirror.test.mjs:4-5`, `test/restyle.test.mjs:307-313`. → garder l'explication canonique dans `mirror.ts`, la référencer depuis les tests.
- **Mysterious Name** (léger) — `const r = runCli(...)` dans les deux nouveaux tests ; correspond au style existant du fichier, donc borderline.
- **Shotgun Surgery** — 6 fichiers pour un fix, mais la régénération de `baseline.json` dans le même diff est mandatée par l'AC4 et le pattern golden-output (ADR 0002) ; endorse par le repo, non flaggé.

Pas de Feature Envy, Speculative Generality, Repeated Switches ni Refused Bequest dans ce diff. `mirror.ts` supprime en fait une petite boucle — simplification nette.

## Spec

### (a) Exigences manquantes / partielles

1. AC : *« Tests au comportement inchangé par ailleurs ; suite complète verte ; coverage ≥80 % ; **CI verte** »* — cochée `[x]`, mais la Livraison admet elle-même *« branche **non poussée** -> la run `ubuntu-latest` reste à déclencher »*. CI verte non vérifiée ; l'AC est prétendue done prématurément.
2. AC : *« baseline … avec la justification de la divergence (**un seul champ change** : l'identité du rollback racine) ; le reste de la capture est inchangé »* — **trois** champs changent, pas un : `out` (sha/len/text, liste mirrored), `bak_equals_original`, `bak_canon_sha`. La Livraison le concède (*« Champs modifiés : `out` … `bak_equals_original` … et `bak_canon_sha` »*). Le changement `out` est une conséquence directe du fix et est honnêtement divulgué, mais l'AC telle que rédigée (« un seul champ ») n'est pas littéralement remplie.

### (b) Comportement non demandé (scope creep)

3. Entrée `CHANGELOG.md` `#### Fixed` — la spec n'exige un write-back spec + mise à jour du contrat documenté *que si l'implémentation conclut que l'inverse est préférable*. L'implémentation a gardé la direction de la spec ; donc ni write-back ni update de contrat n'étaient dus. Entrée CHANGELOG en extra (mineur, conventionnel).
4. Réécriture du cas existant `test/mirror.test.mjs` et de ses comments d'en-tête — conséquence nécessaire du changement de comportement, pas du creep.

### (c) Implémenté mais semble incorrect

5. `test/mirror.test.mjs` : asserte `existsSync(draft_content.json.bak) === false` après `mirrorFont`. Dans le vrai flux, `persistDraft` crée le `.bak` *avant* que `mirrorFont` ne tourne ; l'invariant qui compte est « le miroir ne réécrit pas un `.bak` existant », pas « le miroir ne crée jamais de `.bak` ». Le `fakeDraftDir` du test unitaire n'a pas de `.bak` préexistant, donc il ne peut pas attraper une régression de type overwrite ; seul le test CLI dans `restyle.test.mjs` couvre ça. Le test passe, mais il teste un contrat plus faible que *« le `.bak` racine n'est jamais écrasé »*.

### Ce qui est conforme

- AC1/AC2 : `.bak` racine == octets pré-édition byte-identical + indent d'origine conservé.
- AC3 : cibles de lecture CapCut rafraîchies (`template-2.tmp` + `Timelines/<guid>/*`).
- Baseline : un seul cas divergent (`subtitles/restyle-with-font`), 89 autres inchangés.
- AC5 : test CLI réel avec `strictEqual` sur les octets, qui échouerait sans le fix.
- AC6 : chemin sans police inchangé (`mirrored: []`, `.bak == original`).
- `mirror.ts` arrête d'écrire le `.bak` racine tout en gardant `template-2.tmp` + les miroirs de timeline.
- Direction conforme à la spec → aucun write-back de spec dû.

---

## Synthèse (une ligne par axe, pas de vainqueur unique)

- **Standards :** 0 violation dure ; 4 tensions docs + 4 smells ; pire = la rationale du `.bak` racine dupliquée en 3 endroits.
- **Spec :** 2 AC non littéralement tenues (CI non prouvée cochée `[x]`, « un seul champ » = 3 champs) + 1 test unitaire plus faible que le contrat ; pire = AC7 cochée alors que la CI n'a jamais tourné.

## Actions recommandées (pour le prochain agent)

1. Décocher ou qualifier l'AC7 tant que la branche n'est pas poussée et la run CI verte observée ; ne pas marquer `done` avant.
2. Reformuler l'AC4 (« un seul champ ») ou documenter dans l'issue que les 3 champs divergents sont la conséquence minimale du fix.
3. Renforcer `test/mirror.test.mjs` : pré-créer un `.bak` dans le `fakeDraftDir` et asserter qu'il est inchangé après `mirrorFont` (contrat « jamais écrasé »).
4. Dédupliquer la rationale du `.bak` (canonique dans `mirror.ts`, référencée depuis les 2 tests) et extraire le helper de setup des 2 tests CLI.
5. Réconcilier `AGENTS.md` (GitHub Issues) avec `docs/agents/issue-tracker.md` (`.scratch/…/issues/`) — un des deux est stale.
6. Glossaire `CONTEXT.md` : ajouter « rollback » ; aligner le comment `mirror.ts:155` sur la définition de « Mirror ».
