# ADR 0002 - Chantier ARCH : ordre, découpage en PRs et filet golden-output

Suite à l'audit 2026-09-21 (§7, lot ARCH actif) et à la décision Route A « drafts-first » (mémo 2026-09-22), nous exécutons trois refactors comportement-préservant : migration DraftStore (suppression de la façade `loadedByPath`), registry `Map<verb, handler>` avec sortie unique dans `index.ts`, et fin du split domaine/CLI. Ordre : **DraftStore → registry → split** (préparatory refactoring : les cibles du split contiennent des call sites `saveDraft`, les migrer deux fois serait du gaspillage ; précédent déjà en prod : `edit-cli.ts` migre via `store: DraftStore = new LocalDraftStore()` en paramètre par défaut, signature-compatible).

Le split est découpé en **une PR par module** (ui, remove-segment, batch, validate+validate-fix — qui forment un seul verbe au dispatch et un couplage d'import bidirectionnel), et non une PR globale : la détection de défauts en review s'effondre au-delà de ~200-400 LOC (étude SmartBear/Cisco), et les modules deviennent indépendants une fois le registry en place. `inspect.ts` est **exclu du split** : ses 8 handlers sont déjà exportés et dispatchés, ils seront simplement enregistrés dans le registry ; extraire ses builders purs hors des 24 `console.*` est un refactor non-mécanique reporté à un lot ARCH ultérieur (même logique que l'exclusion de `pipeline.ts`/ARCH-B5). `pipeline.ts` reste hors lot (ARCH-B5 non tranché).

Le filet de non-régression est un **golden-output check livré en PR 0 préalable** (script versionné + job CI dédié) : stdout/stderr/exit code des commandes read-only sur chaque fixture anonymisée + round-trip d'écriture sur copies temporaires, avec canonicalisation des UUIDs/chemins (précédent : `canon()` de `batch-media.test.mjs`). Il se pose **avant** de toucher au code (Feathers : le filet de caractérisation précède le changement) et son absence rendrait chaque PR du chantier invérifiable mécaniquement. DoD global des PRs du chantier : tests au **comportement inchangé** (les imports d'internes peuvent changer de chemin), contrats JSON de sortie identiques au golden-output, coverage ≥80 % maintenue, CI 15/15 (14 jobs + golden-output).

## Considered Options

- **Une PR globale pour le split** : rejetée (review inefficace au-delà de 400 LOC ; modules indépendants après registry).
- **Golden-output dans la 1re PR DraftStore** : rejeté (mélange de lots ; le filet doit exister avant le premier geste).
- **DraftStore en 2 tickets (create-cli puis le reste)** : rejeté — le pilote du pattern existe déjà (`edit-cli.ts`), les diffs sont mécaniques (~2 lignes/site), un motif = un changement unique pour une seule review ; deux PRs créeraient un état intermédiaire à trois styles de sauvegarde.
- **Inspect dans le split** : rejeté (PR vide ou glissement non-mécanique).
- **Sortie unique via un `process.exit()` central** : rejeté — privilégier `process.exitCode = code` + sortie naturelle ; un `exit()` central recréerait le bug de troncature `--help` (~8 ko) documenté à `index.ts:490`.

---

## Clarification post-ticket 02 (2026-09-23, audit adversarial)

Le ticket 02 exigeait « sans changer aucun comportement observable ». Une
exception, unique et bornée, a été appliquée **et doit être lue comme telle** :

- **Fait** : les 7 verbes du module `edit` (`set-text`, `shift`, `shift-all`,
  `speed`, `volume`, `trim`, `opacity`) écrivaient, depuis `6ffc030`/`02bb642`,
  un `.bak` **vide (0 octet)** et ré-sérialisaient le draft en **JSON compact
  (indent 0)**, alors que la façade `saveDraft` (utilisée par les 10 autres
  modules) préservait les octets d'origine et l'indent.
- **Décision** : lors de la migration, `persistDraft` avec `raw` omis récupère
  les octets disque (comportement exact de la façade supprimée). Le résultat
  observable **revient** à celui d'avant `6ffc030` : `.bak` = octets d'origine,
  indent d'origine préservée.
- **Portée** : `stdout`, `stderr`, codes d'exit et contrats JSON **inchangés**
  (golden `--check` : signature canonique identique) ; seul le fichier écrit et
  son `.bak` sont restaurés. Aucun nouveau verbe, aucun changement de schéma.
- **Pourquoi c'est dans le périmètre** : la façade supprimée *était* le contrat
  à préserver ; sa réplique restaurée corrige une régression antérieure non
  détectée (aucun test n'exerçait `index.ts → handler → persistDraft`). Ne pas
  « re-corriger » en réintroduisant l'écriture compacte.
- **Verrou** : `test/draft-fidelity.test.mjs` (8 tests) + les baselines golden
  (voir `test-fixtures/golden/README.md`, entrée `8d652ac`).

## Clarification - workstream bak-rollback-integrity (2026-09-23)

Le DoD ci-dessus (« contrats JSON de sortie identiques au golden-output ») se lit absolu. Le workstream
**bak-rollback-integrity** (tickets 01-02, spec `.scratch/bak-rollback-integrity/`) fait une exception **unique,
bornée et documentée** : corriger la collision « rollback racine » du verbe `restyle` avec preset de police
**change un contrat stdout observable** — la liste `mirrored` perd `draft_content.json.bak` (le miroir n'écrit
plus le rollback racine). La baseline golden est régénérée **dans le même diff** (AC4 du ticket 02), avec
justification ; les 89 autres cas et les autres verbes sont inchangés. Détail : spec du workstream.

## Consequences

- Le registry doit couvrir les 34 cases **et les chemins non-verbaux** (`--help`, version, capabilities, erreurs de parsing) : 10 des 14 `process.exit` vivent avant le switch — c'est là que se cachent les exits oubliés.
- La PR validate doit conserver l'export `hasBlockingErrors` depuis `./validate.js` (consommé par le jumeau CLI `remove-segment-cli.ts`), sous peine de contaminer une PR adjacente.
- À la clôture du chantier DraftStore, la façade `@deprecated` (`saveDraft`/`loadDraft`, `draft.ts:169-186` incluant `loadedByPath`) est **supprimée** — décision à confirmer au moment du ticket ; les call sites sont alors tous sur le store.

## Clôture (2026-09-26)

Chantier terminé : 9/9 tickets `done` (spec `00` + tickets `01`–`09` sous
`.scratch/arch-workstream/issues/`), aucune évolution de comportement hors les
deux exceptions bornées ci-dessus (post-ticket 02 et bak-rollback-integrity).

- **01 golden-output (PR 0)** : PR #5 (`c2efb07`) + extension M1 PR #8
  (`887b107`/`6197b65`, merge `ed7720d`).
- **02 DraftStore** : PR #5 (merge `6e1ff81`) — 10 fichiers migrés, façade
  `saveDraft`/`loadDraft`/`loadedByPath` supprimée (0 call site résiduel) ;
  follow-ups `5af48a7`.
- **03 registry/sortie unique** : PR #9 + correctif F1 `cd21f02` (aide reconnue
  uniquement en premier argument, +6 captures golden) ; CI `36105427312` 15/15.
- **04 split ui** : PR #10 ; **05 split remove-segment** : PR #11
  (`36125286218`) ; **06 split batch** : PR #12 (`36143178388`) ;
  **07 split validate** : PR #13 (`36166218419`, coverage 95,01 % lignes /
  98,24 % fonctions).
- **08 coverage dispatcher (follow-up audit 03)** : PR #14 — gate étendu à
  `dist/index.js` + `dist/utils`.
- **09 golden validate --fix (follow-up audit 07)** : PR #15 (HEAD `9e130fb`) —
  `--fix` dry-run + `--fix --apply` + cas bloqué figés ; refus `--write`
  non-déterministe vérifié (baseline `cc27f550…`, 359216 octets).

État final : `scripts/golden-output.mjs` = **434 captures + 116 round-trips
identiques**, CI **15/15**, coverage ≥80 % maintenue. Exclusions confirmées :
`inspect` (handlers enregistrés tels quels) et `pipeline` (lot ARCH-B5)
hors split. Ne pas réintroduire l'écriture compacte `edit` ni d'`exit()`
dispersé.
