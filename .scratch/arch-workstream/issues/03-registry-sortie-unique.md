# 03: registry sortie unique

**What to build:**

Le switch central du dispatcher devient un registry : chaque verbe est enregistré dans une map, y compris les handlers déjà exportés d'inspect (enregistrés tels quels, sans refactor de leur présentation). Les chemins non-verbaux (aide, version, capabilities, erreurs de parsing) sont couverts par le même mécanisme — c'est là que vivent la majorité des sorties précoces dispersées. La sortie est centralisée : les handlers retournent leur code d'exit, le dispatcher l'affecte via `process.exitCode` et laisse le processus se terminer naturellement ; aucun appel d'exit prématuré ne subsiste (le bug historique de troncature de l'aide via exit dans le flux de sortie ne doit pas pouvoir revenir).

**Acceptance criteria:**

- [ ] Une map verbe → handler remplace le switch ; les 8 handlers d'inspect sont enregistrés tels quels
- [ ] Les chemins non-verbaux passent par le même mécanisme de sortie centralisée
- [ ] Zéro appel direct d'exit dans le flux normal : `process.exitCode` + retour naturel ; l'aide s'affiche intégralement (régression de troncature impossible)
- [ ] Tous les codes d'exit existants sont préservés à l'identique (vérifié par le golden-output)
- [ ] Les tests au comportement inchangé passent, coverage ≥80 %, CI 15/15

**Status:** ready-for-agent

**Blocked by:** 01 - golden-output

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)
