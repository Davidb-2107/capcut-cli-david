# 08: couverture du dispatcher CLI

**What to build:**

Étendre le gate de couverture pour mesurer le dispatcher CLI (`dist/index.js`) et les utilitaires CLI pertinents sous `dist/utils`. Le gate actuel ne couvre que `dist/commands/**/*.js` et `dist/draft.js` : il peut donc afficher une couverture globale satisfaisante sans mesurer les chemins de dispatch, de parsing et de sortie du dispatcher. Ajouter des tests comportementaux ciblés sur ces chemins, en conservant les contrats stdout/stderr et codes d'exit établis par le golden-output.

**Acceptance criteria:**

- [ ] Le rapport de couverture inclut le dispatcher `dist/index.js` et les utilitaires CLI pertinents de `dist/utils`
- [ ] Les chemins de dispatch, d'aide, d'erreur de parsing et de code d'exit sont exercés par des tests comportementaux
- [ ] Le seuil de couverture protège explicitement ces cibles et la CI reste verte
- [ ] Les sorties et codes d'exit observés par le golden-output restent identiques

**Status:** ready-for-agent

**Blocked by:** None (follow-up à l'audit du ticket 03)

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)

**Source:** finding F3 de `audit-ticket03.md` ; limite vérifiée dans `package.json` (`test:coverage`).
