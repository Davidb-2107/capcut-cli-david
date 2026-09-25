# 07: split validate

**What to build:**

Le couple validate est traité comme une seule unité : le verbe `validate` et son mode `--fix` (module validate-fix) partagent un couplage d'import et un couplage de dispatch (un seul verbe, deux chemins adjacents). Le split extrait la logique pure de validation et de plan de correction vers le domaine, les deux adhésions CLI restant aux commandes. Contrainte : la fonction de contrôle de blocage reste exportée du module domaine validate au même chemin, car remove-segment la consomme ; le module validate-fix continue d'importer ses primitives depuis ce module (ce couplage est assumé, documenté, non rompu).

C'est la plus grosse PR du chantier : le golden-output et le crescendo des petits splits la rendent mécanique.

**Acceptance criteria:**

- [x] Logique pure de validation + plan de correction au domaine ; les deux adhésions CLI (validate, --fix) restent aux commandes
- [x] L'export partagé (contrôle de blocage) reste au même chemin depuis le module domaine validate
- [x] Le verbe conserve nom, contrats JSON, codes d'exit, y compris le comportement de re-validation depuis l'état disque après correction (golden-output identique)
- [x] Tests au comportement inchangé ; couverture des deux chemins au seam unitaire
- [ ] Coverage ≥80 % maintenue, CI 15/15

**Status:** in-progress

**Validation locale (2026-09-25) :** 78 tests ciblés verts ; golden-output : 434 captures + 116 round-trips identiques pour les commandes couvertes, dont `validate` sans `--fix`. La re-validation après `--fix --apply` est vérifiée par le test `[D4]` (relecture disque) et le test au store injecté ; le golden ne couvre pas `--fix`. Coverage : 95,32 % lignes sous Node 24 lors de l'implémentation, 95,16 % sous Node 22 lors de l'audit indépendant ; 98,24 % fonctions dans les deux cas. CI 15/15 en attente d'une PR vers `master` : un simple push de `codex/**` ne déclenche pas le workflow.

**Blocked by:** 03 - registry ; 05 - remove-segment (contrainte d'export partagé)

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)
