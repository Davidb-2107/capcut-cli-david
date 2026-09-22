# 01: golden output filet

**What to build:**

Un filet de caractérisation mécanique qui capture, pour chaque fixture anonymisée du dépôt, la sortie standard, la sortie erreur et le code d'exit de toutes les commandes read-only (info, tracks, segments, texts, materials, segment, material, export-srt, validate sans --fix, query, capabilities, --help), plus un round-trip d'écriture sur copies temporaires pour les commandes qui persistent. Les captures sont canonicalisées (UUIDs générés et chemins temporaires remplacés par des jetons stables) puis comparées à une baseline commitée. Un job CI dédié exécute la comparaison : toute divergence non-justifiée fait échouer la PR.

Ce ticket est la PR 0 du chantier ARCH : il ne change aucun code de production, il pose le filet qui rend tous les tickets suivants vérifiables mécaniquement.

**Acceptance criteria:**

- [ ] Un script versionné sous `scripts/` régénère les captures golden (stdout/stderr/exit) sur toutes les fixtures, avec canonicalisation UUIDs/chemins (précédent : le canon des tests batch)
- [ ] La baseline dorée est commitée et le job CI dédié compare la sortie de la PR à la baseline : divergence = échec
- [ ] Le round-trip d'écriture vérifie qu'une commande persistante produit des octets identiques avant/après sur copies temporaires
- [ ] La CI passe 15/15 (14 jobs existants + job golden-output)
- [ ] Aucun fichier de production modifié (hors CI et scripts)

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)
