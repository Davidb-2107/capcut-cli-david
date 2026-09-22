# 05: split remove segment

**What to build:**

Le module remove-segment est splitté selon le même pattern (logique pure au domaine, adhésion CLI au jumeau). Contrainte explicite héritée du couplage vérifié : ce module consomme la fonction de contrôle de blocage exportée par le module validate — cette importation doit rester au même chemin après le ticket validate ; ce ticket ne doit rien faire qui la déplace.

**Acceptance criteria:**

- [ ] Logique pure au domaine, adhésion CLI au jumeau, conformes au pattern des paires existantes
- [ ] L'import de la fonction partagée de validate reste au chemin actuel (aucune contamination croisée avec le ticket validate)
- [ ] Le verbe conserve nom, contrats JSON, codes d'exit (golden-output identique)
- [ ] Coverage ≥80 % maintenue, CI 15/15

**Status:** ready-for-agent

**Blocked by:** 03 - registry

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)
