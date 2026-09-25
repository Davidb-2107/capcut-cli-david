# 04: split ui

**What to build:**

Le plus petit des modules monolithiques restants est splitté selon le pattern maison : la logique pure (transformations du draft, décisions) va dans le module domaine, l'adhésion CLI (parsing, sortie, présentation) dans le jumeau `-cli`. Le verbe garde son nom, ses contrats JSON et son comportement exact ; la PR est petite et sert à valider le motif de split dans l'ère du registry avant les modules plus gros.

**Acceptance criteria:**

- [ ] Logique pure dans le module domaine, adhésion CLI dans le jumeau `-cli`, zéro IO/console dans le domaine (standard des paires existantes)
- [ ] Le verbe conserve nom, contrats JSON, codes d'exit (golden-output identique)
- [ ] Les tests au comportement inchangé passent ; nouveaux tests domaine au seam unitaire existant
- [ ] Coverage ≥80 % maintenue, CI 15/15

**Status:** in-progress

**Blocked by:** 03 - registry

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)
