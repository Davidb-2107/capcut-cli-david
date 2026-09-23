# Spec — intégrité du rollback racine (`draft_content.json.bak`)

## Énoncé du problème

Depuis la migration DraftStore (ticket 02), le contrat de persistance du CLI est : à chaque écriture d'un draft
chargé, le store écrit `<draft>/draft_content.json.bak` **contenant les octets d'avant l'écriture**, et
`sync-timelines` documente explicitement que ce fichier est « le rollback privé de la dernière édition racine,
qu'il ne faut jamais écraser ».

Ce contrat est **violé** par le verbe `restyle` lorsqu'un preset porte une police : après le `persistDraft` du store,
`mirrorFont` réécrit le **même fichier racine** `draft_content.json.bak` avec le **nouveau** draft (en forme
compacte), détruisant le rollback que le store vient d'écrire.

Reproduction mécanique (copie temporaire de `subtitles-draft`, preset portant une police) :

```
restyle stdout   : {"ok":true,"materials_patched":28,"segments_patched":28,
                    "mirrored":["template-2.tmp","draft_content.json.bak"]}
sha original     : 22d43b008377 (310628 o, indent 2)
sha draft après  : a5506a038202 (293313 o)
sha .bak racine  : 3b29f5af7de5 (194958 o)   <-- = template-2.tmp, PAS l'original
.bak == original : false   (rollback détruit)
```

Trois préjudices en un : le rollback n'existe plus ; il ne correspond à aucune version antérieure ; il est écrit en
JSON compact alors que le store écrit avec l'indent d'origine.

## Origine et statut

- **Préexistant** : l'ordre « save puis mirror » et `mirrorFont` sont antérieurs au chantier ARCH ; l'audit du
  ticket 02 l'a identifié puis **écarté du périmètre du ticket 02** (non introduit, non aggravé par la migration).
- **Réel et non couvert** : le filet golden exerce `restyle` avec un preset **sans** police → `mirrorFont` sort tôt
  et la collision n'est jamais déclenchée ; aucun test n'exerce `restyle` avec police **et** vérifie le `.bak` racine.
- **Cas d'usage réel** : `restyle --preset` appliqué à une police est exactement le flux CapCut-CaptionStyling
  (parité Python portée dans `mirrorFont`).

## Décision à trancher (portée du fix)

Le fichier racine `draft_content.json.bak` porte **deux significations concurrentes** :

1. **rollback du CLI** — octets d'avant la dernière écriture (contrat du store, documenté dans `sync-timelines`) ;
2. **miroir de parité Python** — les patchers CapCut-CaptionStyling écrivent le contenu **nouveau** dans les
   jumeaux `template-2.tmp` / `.bak` que CapCut relit.

Ces deux significations ne peuvent pas coexister sur le même fichier. Direction recommandée : **le rollback gagne
sur la racine** (c'est la garantie de récupération), le miroir rafraîchit `template-2.tmp` et les copies
`Timelines/<guid>/*` (qui ont leur propre `.bak` à l'intérieur du miroir). Toute autre direction doit être
explicitée et justifiée dans le ticket de fix.

## Hors périmètre

- Le reste de la parité Python de `mirrorFont` (fonts injectées, `key_value.json`, journaux de timeline).
- Le comportement des `.bak` **à l'intérieur** des miroirs `Timelines/<guid>/` (créés par `sync-timelines`).
- Tout autre verbe : `restyle` est ici le seul call site de `mirrorFont` après un `persistDraft`.

## Fichiers du chantier

- `01-net-restyle-with-font.md` — rendre la collision visible/mécaniquement détectable (premier, sans changement de comportement).
- `02-restyle-font-preserves-root-rollback.md` — corriger la collision (bloqué par 01).
