# 06: split batch

**What to build:**

Le module batch est splitté selon le pattern maison. Particularité vérifiée : il consomme sept handlers d'autres modules via leur jumeau CLI ; le split préserve ces réutilisations telles quelles (le batch orchestre, les handlers restent là où ils sont — ce ticket ne migre pas leurs modules, qui ne sont pas dans le lot).

**Acceptance criteria:**

- [x] Logique pure de coordination au domaine, adhésion CLI au jumeau, conformes au pattern
- [x] Les réutilisations des handlers d'autres modules restent inchangées (mêmes chemins d'import)
- [x] Le verbe conserve nom, contrats JSON, codes d'exit, honnêteté d'exit sur échec partiel (tests `batch` au bord du processus + fidelity sweep ; golden global inchangé, sans capture `batch`)
- [x] Coverage ≥80 % maintenue, CI 15/15

**Status:** done

**Blocked by:** 03 - registry

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)

**Vérification locale (2026-09-25) :** build et tests avec gate coverage ≥80 % verts ; golden-output global : 434 captures et 116 round-trips identiques (le verbe `batch` n'y figure pas) ; tests `batch` au bord du processus et fidelity sweep : 21/21.

**Done (2026-09-25) :** PR #12 ; CI run `36143178388` : 15/15 ; golden-output : 434 captures et 116 round-trips identiques.
