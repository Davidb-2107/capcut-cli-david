# 09: filet golden validate --fix

**What to build:**

Étendre le filet `scripts/golden-output.mjs` au mode `validate --fix`, absent des captures et des `WRITE_ROUNDTRIPS` actuels. Capturer le dry-run sur toutes les fixtures fournies par `FIXTURE_KEYS`, puis exercer `--fix --apply` sur des copies temporaires contenant des orphelins text et media ajoutés de façon déterministe. Figer stdout, stderr, code d'exit et état écrit après correction, y compris le rapport résiduel issu de la re-validation. Le cas bloqué (draft incohérent) doit prouver le refus avant toute écriture.

Cette extension prépare les futurs refactors de `--fix` ; sa nouvelle baseline ne sert pas de preuve rétroactive au split du ticket 07. Livrer dans une PR dédiée, sans modifier les commandes de production ni le gate de couverture du ticket 08.

**Acceptance criteria:**

- [x] `validate --fix` sans `--apply` est capturé sur chaque fixture du corpus ; stdout, stderr et exit sont stables, et la commande n'écrit rien
- [x] Un `--fix --apply` sur deux copies fraîches d'un draft avec orphelins text et media capture stdout/stderr/exit, supprime les orphelins et rapporte le résiduel après re-validation ; les sorties canonicalisées et les octets finaux sont identiques entre copies
- [x] Le cas bloqué (orphelin + référence pendante ou id dupliqué) sort avec le code 2 et laisse le draft intact, sans `.bak` ; sa sortie est capturée
- [x] `--write` refuse une capture non déterministe ; la baseline ajoutée est justifiée dans la PR et `--check` passe sans régénération
- [x] Aucun code de production modifié ; comportement des tests existants inchangé ; CI 15/15 (PR #15)

**Status:** done

**Blocked by:** None (follow-up indépendant des tickets 07 et 08)

**Spec:** voir `00-spec-chantier-arch.md` (user story 6 et décisions de test)

**Source:** finding M2 de l'audit du ticket 07 (2026-09-25) ; `scripts/golden-output.mjs` et `test-fixtures/golden/baseline.json`.
