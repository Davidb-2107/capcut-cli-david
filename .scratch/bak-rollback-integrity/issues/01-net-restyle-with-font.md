# 01: net — restyle avec police (rendre la collision rollback détectable)

**What to build:**

Le filet de caractérisation doit exercer `restyle` avec un preset **portant une police** — le seul chemin qui
déclenche le miroir de police — et figer, dans la même capture, l'état du rollback racine (`draft_content.json.bak`)
et des jumeaux que CapCut relit.

Ce ticket ne change **aucun comportement** : il enregistre l'état actuel (rollback écrasé par le miroir) afin qu'il
devienne une signature mécanique. Toute modification ultérieure — correction du ticket 02 ou régression d'un autre
verbe — devra alors passer par une mise à jour de baseline explicitement justifiée, au lieu de passer inaperçue.

Doit être vérifiable de bout en bout : relancer le filet sur une copie temporaire d'une fixture, avec un preset de
police local, et obtenir une capture stable (deux exécutions identiques) publiée comme baseline.

**Acceptance criteria:**

- [ ] Un cas de round-trip `restyle` **avec police** est capturé par le filet (stdout/stderr/exit + artefact)
- [ ] La capture inclut l'identité du **rollback racine** (`draft_content.json.bak`) et la liste des jumeaux écrits
      par le miroir (`template-2.tmp`, miroirs `Timelines/…` le cas échéant)
- [ ] Deux exécutions consécutives produisent une capture identique (déterminisme), y compris sur un checkout LF
- [ ] Le job CI du filet reste vert : la collision est enregistrée, pas encore corrigée
- [ ] Aucun changement de comportement produit (aucun fichier de production modifié)

**Status:** ready-for-agent

**Blocked by:** None (can start immediately)

**Spec:** voir `00-spec-bak-rollback-integrity.md` (ce dossier)
