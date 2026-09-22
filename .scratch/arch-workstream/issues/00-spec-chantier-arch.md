## Énoncé du problème

Le dispatcher central du CLI est un monolithe : un switch géant câble chaque verbe à la main, la sortie (codes d'exit) est éparpillée, et la persistance passe par une façade globale (`saveDraft`/`loadDraft`) qui masque un état caché. Chaque ajout ou modification de verbe exige de lire et toucher ce fichier central, les tests ne peuvent pas injecter un store, et aucun filet mécanique ne prouve qu'un refactor préserve les contrats de sortie. Le chantier ARCH (audit §7, Route A) doit corriger cela **sans changer aucun comportement observable**.

## Solution

Trois refactors comportement-préservant, dans cet ordre : (1) migrer toute la persistance vers le `DraftStore` injectable (précédent : le module edit) puis supprimer la façade ; (2) remplacer le switch par un registry de handlers et centraliser la sortie (`process.exitCode`, jamais d'`exit()` dispersé) ; (3) finir le split domaine/CLI des derniers modules monolithiques, une PR par module. Un filet de caractérisation « golden-output » est posé **avant** le premier geste : sortie standard/erreur et code d'exit de toutes les commandes read-only capturés sur les fixtures, puis diffés à chaque PR.

## User stories

1. As a mainteneur du CLI, je veux que toute persistance passe par le `DraftStore` injectable, afin qu'aucune variable globale cachée ne détermine ce qui est écrit sur disque.
2. As a mainteneur du CLI, je veux que la façade dépréciée soit supprimée une fois tous les call sites migrés, afin qu'un seul idiome de sauvegarde existe et que le code soit honnête.
3. As un agent IA opérant le codebase, je veux un dispatcher en registry, afin d'ajouter ou modifier un verbe sans lire un switch de plusieurs centaines de lignes.
4. As un agent IA opérant le codebase, je veux que les tests puissent injecter un store en mémoire, afin de tester les commandes d'écriture sans disque réel.
5. As un relecteur de PR, je veux des PR de split découpées par module, afin que chaque review reste dans la zone où la détection de défauts est efficace.
6. As un relecteur de PR, je veux un diff golden-output automatique dans la CI, afin de valider mécaniquement qu'un refactor préserve les contrats de sortie sans relire chaque test.
7. As un contributeur futur, je veux un glossaire et un ADR de référence, afin de comprendre pourquoi inspect et pipeline sont exclus du split et ne pas les « réparer » par erreur.
8. As un utilisateur final du CLI, je veux que `--help` et tous les contrats JSON restent identiques octet pour octet (à la canonicalisation près), afin que la mise à jour du CLI soit invisible pour mes scripts.
9. As un utilisateur final du CLI, je veux que les codes d'exit restent exactement les mêmes, afin que mes pipelines d'automatisation ne cassent pas.
10. As un mainteneur du CLI, je veux que la sortie soit centralisée via `process.exitCode` plutôt que des `exit()` dispersés, afin que le runner de tests ne soit jamais tué et que le bug historique de troncature de `--help` ne revienne pas.
11. As un mainteneur du CLI, je veux que les handlers d'inspect soient simplement enregistrés dans le registry, afin que la couverture du registry soit totale sans refactor non-mécanique caché.
12. As un relecteur de PR, je veux que la contrainte d'export partagé entre validate et remove-segment soit explicite dans le ticket, afin qu'une PR n'contamine pas sa voisine.

## Décisions d'implémentation

- **Ordre** : persistance (façade → store) → registry/sortie unique → splits de modules. Préparatory refactoring : les cibles du split contiennent des call sites de la façade, les migrer deux fois serait du gaspillage.
- **Migration persistance** : un seul ticket, un seul motif — injection du store en paramètre par défaut (signature-compatible, les appelants du dispatcher ne changent pas), répété sur les 10 fichiers concernés ; la façade et sa map d'état caché sont **supprimées** à la clôture (pas conservées dépréciées).
- **Registry** : une `Map<verb, handler>` couvrant tous les verbes **et les chemins non-verbaux** (aide, version, erreurs de parsing) ; les handlers d'inspect existants sont enregistrés tels quels ; la sortie est centralisée via `process.exitCode` + sortie naturelle — aucun `exit()` central ne reproduit le bug de troncature du tampon de sortie documenté dans le dispatcher.
- **Split** : pattern maison (logique pure dans le module domaine, adhésion CLI dans le jumeau `-cli`) appliqué à ui, remove-segment, batch, et au couple validate (le verbe `validate` et son mode `--fix` forment une seule unité : couplage d'import et de dispatch). Le module validate conserve l'export partagé consommé par remove-segment au même chemin. inspect et pipeline sont **hors périmètre** (inspect : déjà handlers exportés, couvert par le registry ; pipeline : lot ARCH-B5 non tranché).
- **PRs** : une PR par ticket ; le filet golden-output précède tout (PR 0).

## Décisions de test

- **Seam principal (le plus haut possible)** : la frontière du processus CLI — stdout, stderr et exit code. Le golden-output capture ces trois flux sur chaque fixture anonymisée pour toutes les commandes read-only, plus un round-trip d'écriture sur copies temporaires ; la canonicalisation retire UUIDs et chemins temporaires (précédent existant dans les tests du module batch).
- **Seam unitaire (existant, à préférer à tout nouveau)** : l'injection de store par paramètre par défaut — les tests injectent un store en mémoire ; aucun nouveau seam d'architecture n'est créé.
- **Un bon test ne teste que le comportement externe** : les tests existants peuvent changer leurs imports d'internes (les modules bougent), jamais leur comportement ni leurs assertions.
- **DoD global** : tests au comportement inchangé, golden-output identique, coverage ≥80 %, CI entièrement verte avec le nouveau job golden-output (15/15).

## Hors périmètre

- Toute évolution de comportement, tout nouveau verbe, tout changement de contrat JSON.
- Le refonte de `pipeline` (lot ARCH-B5, non tranché) et l'extraction des builders purs d'inspect (refactor non-mécanique, futur lot ARCH).
- La décision Windows-first vs multi-OS (mini-mémo séparé, N9).
- Toute exposition réseau, auth, sandbox chemins (reportés avec déclencheurs objectifs, §7 audit).

## Further notes

- Références : ADR 0002 (stratégie du chantier), ADR 0001, glossaire du dépôt, §7 de l'audit 2026-09-21 (réécrit après décision Route A), mémo de décision produit 2026-09-22.
- Le filet golden-output est lui-même livré en PR 0 et doit être vert sur master **avant** toute autre PR du chantier.
