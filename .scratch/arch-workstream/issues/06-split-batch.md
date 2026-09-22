# 06: split batch

**What to build:**

Le module batch est splitté selon le pattern maison. Particularité vérifiée : il consomme sept handlers d'autres modules via leur jumeau CLI ; le split préserve ces réutilisations telles quelles (le batch orchestre, les handlers restent là où ils sont — ce ticket ne migre pas leurs modules, qui ne sont pas dans le lot).

**Acceptance criteria:**

- [ ] Logique pure de coordination au domaine, adhésion CLI au jumeau, conformes au pattern
- [ ] Les réutilisations des handlers d'autres modules restent inchangées (mêmes chemins d'import)
- [ ] Le verbe conserve nom, contrats JSON, codes d'exit, honnêteté d'exit sur échec partiel (golden-output identique)
- [ ] Coverage ≥80 % maintenue, CI 15/15

**Status:** ready-for-agent

**Blocked by:** 03 - registry

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)
