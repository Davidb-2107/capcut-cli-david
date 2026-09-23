# 01: golden output filet

**What to build:**

Un filet de caractérisation mécanique qui capture, pour chaque fixture anonymisée du dépôt, la sortie standard, la sortie erreur et le code d'exit de toutes les commandes read-only (info, tracks, segments, texts, materials, segment, material, export-srt, validate sans --fix, query, capabilities, --help), plus un round-trip d'écriture sur copies temporaires pour les commandes qui persistent. Les captures sont canonicalisées (UUIDs générés et chemins temporaires remplacés par des jetons stables) puis comparées à une baseline commitée. Un job CI dédié exécute la comparaison : toute divergence non-justifiée fait échouer la PR.

Ce ticket est la PR 0 du chantier ARCH : il ne change aucun code de production, il pose le filet qui rend tous les tickets suivants vérifiables mécaniquement.

**Acceptance criteria:**

- [x] Un script versionné sous `scripts/` régénère les captures golden (stdout/stderr/exit) sur toutes les fixtures, avec canonicalisation UUIDs/chemins (précédent : le canon des tests batch)
- [x] La baseline dorée est commitée et le job CI dédié compare la sortie de la PR à la baseline : divergence = échec
- [x] Le round-trip d'écriture vérifie qu'une commande persistante produit des octets identiques avant/après sur copies temporaires
- [x] La CI passe 15/15 (14 jobs existants + job golden-output)
- [x] Aucun fichier de production modifié (hors CI et scripts)

**Status:** done

**Done (2026-09-23) :** filet initial `c2efb07` (PR 0, avec PR #5) + extension M1 `887b107`/`6197b65` (PR #8, merge `ed7720d`). État courant : `scripts/golden-output.mjs` = 428 captures read-only + 116 round-trips, baseline `test-fixtures/golden/baseline.json`, job CI `golden-output` (canonicalize normalise UUID/chemins/BOM/CRLF, agnostique OS). Preuve CI : run PR #8 `35892661631` 15/15, run master post-merge `35892903534` success.

**Blocked by:** None (can start immediately)

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)
