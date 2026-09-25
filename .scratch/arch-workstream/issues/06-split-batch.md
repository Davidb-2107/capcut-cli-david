# 06: split batch

**What to build:**

Le module batch est splitté selon le pattern maison. Particularité vérifiée : il consomme sept handlers d'autres modules via leur jumeau CLI ; le split préserve ces réutilisations telles quelles (le batch orchestre, les handlers restent là où ils sont — ce ticket ne migre pas leurs modules, qui ne sont pas dans le lot).

**Acceptance criteria:**

- [x] Logique pure de coordination au domaine, adhésion CLI au jumeau, conformes au pattern
- [x] Les réutilisations des handlers d'autres modules restent inchangées (mêmes chemins d'import)
- [x] Le verbe conserve nom, contrats JSON, codes d'exit, honnêteté d'exit sur échec partiel (golden-output identique)
- [ ] Coverage ≥80 % maintenue, CI 15/15

**Status:** in-progress

**Blocked by:** 03 - registry

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)

**Vérification locale (2026-09-25) :** build et tests avec coverage verts (95,04 % lignes ; 98,24 % fonctions) ; golden-output : 434 captures et 116 round-trips identiques ; fidelity sweep : 21/21. CI 15/15 en attente de la PR.
