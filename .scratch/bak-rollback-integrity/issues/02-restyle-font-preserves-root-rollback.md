# 02: restyle avec police — préserver le rollback racine

**What to build:**

Après un `restyle --preset` dont le preset porte une police, le rollback racine doit **encore contenir les octets
d'avant l'édition** : l'utilisateur qui applique un preset de police (flux CapCut-CaptionStyling) doit pouvoir
revenir en arrière, comme pour tout autre verbe d'écriture.

En clair, de bout en bout : je lance `restyle` avec un preset de police sur un draft, j'ouvre
`draft_content.json.bak`, et j'y trouve la version **précédente** du draft (indent d'origine), tandis que les
jumeaux que CapCut relit pour la police (`template-2.tmp`, copies `Timelines/<guid>/*`) sont bien rafraîchis avec le
contenu courant. Le contrat du store (« un seul idiome de sauvegarde ») et l'invariant documenté par
`sync-timelines` (le `.bak` racine n'est jamais écrasé) redeviennent vrais simultanément.

La direction retenue est celle de la spec : **le rollback gagne sur le fichier racine**, le miroir continue de
rafraîchir les cibles de lecture de CapCut. Si l'implémentation conclut que l'inverse est préférable, la décision
doit être écrite dans la spec et le contrat documenté mis à jour dans le même diff.

**Acceptance criteria:**

- [ ] Après `restyle` avec police, `<draft>/draft_content.json.bak` est **identique aux octets d'avant l'édition**
      (et non plus au nouveau contenu compact)
- [ ] Le rollback conserve l'**indent d'origine** (même fidélité que les autres verbes d'écriture)
- [ ] Les cibles de lecture de CapCut sont toujours rafraîchies : `template-2.tmp` et les miroirs
      `Timelines/<guid>/*` présents reçoivent bien la police (comportement de parité Python inchangé)
- [ ] La baseline du filet est mise à jour **dans le même diff**, avec la justification de la divergence
      (un seul champ change : l'identité du rollback racine) ; le reste de la capture est inchangé
- [ ] Le cas est verrouillé par un test de comportement (CLI réelle sur copie temporaire) qui échoue sans le fix
- [ ] `restyle` **sans** police garde exactement son comportement actuel
- [ ] Tests au comportement inchangé par ailleurs ; suite complète verte ; coverage ≥80 % ; CI verte

**Status:** ready-for-agent

**Blocked by:** 01 — net : restyle avec police (le filet doit d'abord enregistrer l'état actuel pour que la
divergence soit justifiable dans le même diff)

**Spec:** voir `00-spec-bak-rollback-integrity.md` (ce dossier)
