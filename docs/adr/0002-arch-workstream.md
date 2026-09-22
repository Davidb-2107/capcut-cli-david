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

## Consequences

- Le registry doit couvrir les 34 cases **et les chemins non-verbaux** (`--help`, version, capabilities, erreurs de parsing) : 10 des 14 `process.exit` vivent avant le switch — c'est là que se cachent les exits oubliés.
- La PR validate doit conserver l'export `hasBlockingErrors` depuis `./validate.js` (consommé par `remove-segment.ts`), sous peine de contaminer une PR adjacente.
- À la clôture du chantier DraftStore, la façade `@deprecated` (`saveDraft`/`loadDraft`, `draft.ts:169-186` incluant `loadedByPath`) est **supprimée** — décision à confirmer au moment du ticket ; les call sites sont alors tous sur le store.
