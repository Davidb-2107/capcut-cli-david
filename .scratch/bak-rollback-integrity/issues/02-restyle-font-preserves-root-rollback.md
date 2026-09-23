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

- [x] Après `restyle` avec police, `<draft>/draft_content.json.bak` est **identique aux octets d'avant l'édition**
      (et non plus au nouveau contenu compact)
- [x] Le rollback conserve l'**indent d'origine** (même fidélité que les autres verbes d'écriture)
- [x] Les cibles de lecture de CapCut sont toujours rafraîchies : `template-2.tmp` et les miroirs
      `Timelines/<guid>/*` présents reçoivent bien la police (comportement de parité Python inchangé)
- [x] La baseline du filet est mise à jour **dans le même diff**, avec la justification de la divergence
      (un seul champ change : l'identité du rollback racine) ; le reste de la capture est inchangé
- [x] Le cas est verrouillé par un test de comportement (CLI réelle sur copie temporaire) qui échoue sans le fix
- [x] `restyle` **sans** police garde exactement son comportement actuel
- [ ] Tests au comportement inchangé par ailleurs ; suite complète verte ; coverage ≥80 % ; CI verte

> **Notes d'audit (2026-09-23).**
> - **AC7** : les volets locaux sont vérifiés (suite 714/714, coverage 94,96 % lignes / 98,22 % fonctions),
>   mais le volet **CI verte** ne l'est pas (branche non poussée) → AC7 décochée jusqu'à la run `ubuntu-latest`.
> - **AC4** : la capture diverge en réalité sur **3 champs** — `out` (la liste `mirrored` perd
>   `draft_content.json.bak`, conséquence directe du fix), `bak_equals_original`, `bak_canon_sha`. La lecture
>   « un seul champ » ne vaut que pour l'artefact *hors* `out` : `draft_canon_sha`, `bak_exists`,
>   `indent_preserved`, `single_line`, `mirror_twins` sont inchangés.
> - **Contrat stdout** : exception bornée documentée (spec, addendum 2026-09-23 + ADR 0002) ; baseline
>   régénérée dans le même diff.
> - **Test renforcé** : `test/mirror.test.mjs` pré-crée un `.bak` et asserte l'invariant « jamais écrasé ».

**Status:** in-progress

**Blocked by:** 01 — net : restyle avec police (le filet doit d'abord enregistrer l'état actuel pour que la
divergence soit justifiable dans le même diff)

**Spec:** voir `00-spec-bak-rollback-integrity.md` (ce dossier)

---

## Livraison (2026-09-23)

**Branche** `feat/arch-02-restyle-preserves-root-rollback` - **commit** `2b1594f` (parent `c2d2710`) -
5 fichiers, +137/-19 - **non poussee**.

**Direction retenue** (celle de la spec) : le rollback gagne sur le fichier racine. `mirrorFont`
(`src/utils/mirror.ts`) **ne reecrit plus** `draft_content.json.bak` ; il continue de rafraichir
`template-2.tmp` et les miroirs `Timelines/<guid>/*` (parite Python inchangee). Le `.bak` racine reste les
octets d'avant l'edition, ecrits par `persistDraft` avec l'indent d'origine. Le contrat documente par
`sync-timelines` ("le `.bak` racine n'est jamais ecrase") redevient vrai.

Resultat (AC) :

- **AC1** - apres `restyle` avec police, `<draft>/draft_content.json.bak` == **octets d'avant l'edition** :
  `bak_equals_original = true` (test CLI reel : `strictEqual(bakBytes, originalBytes)`).
- **AC2** - indent d'origine conserve : le `.bak` est les octets pre-edition verbatim (2 espaces).
- **AC3** - cibles CapCut rafraichies : `mirrored = ["template-2.tmp","Timelines/<guid>/draft_content.json"]` ;
  `mirror_twins` inchanges (`template-2.tmp = c4c6a9880a97e130`, `Timelines/<GUID>/draft_content.json = 7a6675062b09288d`).
- **AC4** - baseline regeneree **dans le meme diff** : **1 seule** entree diverge (`subtitles/restyle-with-font`) ;
  89 autres cas inchanges. Champs modifies : `out` (la liste `mirrored` perd `draft_content.json.bak`, consequence
  directe du fix), `bak_equals_original` (`false -> true`) et `bak_canon_sha`
  (`c4c6a9880a97e130 -> 5d1b78e42166240d`, identite pre-edition). `draft_canon_sha`, `bak_exists`,
  `indent_preserved`, `single_line`, `mirror_twins` **inchanges** (verifie champ par champ).
- **AC5** - cas verrouille par un test de comportement (CLI reelle sur copie temporaire, `test/restyle.test.mjs`)
  qui **echoue sans le fix** : verifie par remise temporaire de `mirror.ts` ->
  `AssertionError: root .bak must be byte-identical to the pre-edit draft` (le `.bak` contenait alors le draft
  compact nouveau).
- **AC6** - `restyle` **sans** police inchange : `mirrored = []`, `.bak == original`, aucun `template-2.tmp`
  (test dedie + cas golden `subtitles/restyle` inchange).
- **AC7** - suite verte / coverage / CI : voir preuves.

Preuves (rejouables) :
`npm run build` OK ; `node scripts/golden-output.mjs --selftest` OK ;
`node scripts/golden-output.mjs --check` **90/90** ; `--dump` x2 identiques (determinisme) ;
`npm test` **714/714** (712 avant + 2 nouveaux) ; `npm run test:coverage` **94,96 % lignes / 98,22 % fonctions** ;
`npm run test:fidelity` **21/21** ; `npm run typecheck` OK ;
`biome ci` **0 finding** sur le fichier modifie en condition LF (comme la CI). L'echec local de `biome ci .`
reste le preexistant (checkout CRLF + config racine imbriquee `.kilo/`), non imputable a ce diff.

**CI** : branche **non poussee** -> la run `ubuntu-latest` reste a declencher (meme schema que le ticket 01) ;
la baseline a ete regeneree et verifiee en local (Windows) + la parite LF a ete mesuree au niveau du fichier modele.
