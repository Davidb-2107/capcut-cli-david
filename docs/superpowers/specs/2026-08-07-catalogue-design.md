# `catalogue` — mémoire persistante des ressources validées

**Date** : 2026-08-07
**Statut** : design validé, prêt pour le plan d'implémentation
**Verbe** : `catalogue` (41ᵉ)
**Version cible** : 2.6.0 (avec `query --all`, déjà livré)

---

## 1. Le problème

`add-effect`, `add-filter` et `add-transition` exigent un `resource_id` — un nombre
de 19 chiffres. Le CLI n'embarque aucun catalogue : il ne sait rien nommer par
lui-même.

Le flux réel de l'utilisateur n'est pas de taper ces chiffres. Il applique la
police ou l'effet **à la main dans CapCut** — seule façon de choisir avec l'aperçu
sous les yeux — puis un agent va déterrer le `resource_id` dans le draft résultant.

La douleur est donc que **le savoir reste prisonnier d'un draft** : il faut savoir
lequel, re-fouiller à chaque fois, et si le draft témoin est supprimé le savoir est
perdu et il faut tout ré-appliquer.

`query --all` (2.6.0) liste l'inventaire vivant, mais reste sans état : il reflète
les drafts présents à l'instant T. Sur la bibliothèque actuelle il ne remonte que
2 polices et 1 effet, et supprimer un draft les fait disparaître.

## 2. Ce qu'on construit

Un fichier persistant **append-only** qui fige chaque ressource vue une fois, pour
toujours, et que l'humain peut annoter à la main.

Boucle d'usage :

1. David applique une ressource dans CapCut et sauvegarde.
2. `capcut-david catalogue --sync` la moissonne définitivement.
3. Elle reste adressable même si le draft témoin disparaît.
4. David annote l'entrée dans Obsidian ; aucun sync ultérieur n'y touche.

### Périmètre — décision explicite

**Seulement ce qui a été validé dans un draft.** Le cache HTTP de CapCut
(`Cache\ressdk_db\<hash>\rp.db`) contient 14 237 ressources nommées, dont
**4 871 polices** — soit pratiquement le catalogue CapCut complet — et 2 825 effets
vidéo. Il ne contient **ni filtres ni transitions** (leurs panneaux n'ont jamais été
ouverts), et il est incomplet même là où il est riche : la `Vignette` utilisée en
production n'y figure pas.

Ce gisement est **hors périmètre** : chaque entrée du catalogue doit être prouvée
par un draft où l'utilisateur l'a vue rendre. Une entrée moissonnée d'un cache n'a
pas cette garantie. Décision réversible — la source est documentée ici, un champ
`source` pourra la distinguer plus tard sans casser le format.

### Non-objectifs

- Aucun appel réseau, aucune API CapCut, aucun reverse d'endpoint signé.
- Pas de résolution par nom dans `add-effect`/`add-filter`/`add-transition`.
  Ce sont des agents qui composent ces commandes ; ils liront le catalogue.
  À reconsidérer si les fichiers de recettes (`skills/capcut-david/references/`)
  se mettent à contenir des `resource_id` en dur.
- Pas de suppression d'entrée (voir `ignored`, §4).

## 3. Emplacement du fichier

`<vault>/Shared/capcut-catalogue.json`.

Le CLI est publié publiquement sur npm : **aucun chemin de vault en dur**.
Résolution, dans l'ordre :

1. `--catalogue <path>` s'il est fourni ;
2. sinon, remontée des dossiers parents jusqu'au premier ancêtre contenant **à la
   fois** `Projects/` et `Shared/` (racine du vault) → `<racine>/Shared/capcut-catalogue.json` ;
3. sinon (hors vault) → `./capcut-catalogue.json` dans le dossier courant.

Même ancre que `scripts/build-ui.mjs`. L'implémentation vit dans
`src/utils/vault.ts` et `build-ui.mjs` l'importe depuis `dist/` (il tourne après
`tsc`) — une seule implémentation de la remontée.

### Vérifié côté vault

- Le CLI écrivant dans l'arbre principal est **légal** : c'est un *run*, pas une
  édition (carve-out « Pipeline runs stay in the canonical vault path »).
- `vault-session.sh ship-main "<msg>"` versionne le fichier ; son `git add -A`
  ramasse un `Shared/*.json` neuf. **Ne jamais enchaîner `ship-main` avec `|` ou
  `&&`** : une règle hookify du vault (`.claude/hookify.block-ship-piped.local.md`)
  bloque le motif.
- `.gitattributes` du vault force `*.json text eol=lf` : un CLI qui écrit `\n` ne
  produit aucun churn CRLF.
- `Shared/capcut-catalogue.json` n'est couvert par aucune règle `.gitignore`.
- Un **agent ne peut pas** éditer le fichier avec Write/Edit (hook
  `no_main_tree_write.py`, `GATED_TOOLS`). C'est voulu : les notes sont écrites par
  l'humain dans Obsidian.

## 4. Format

```json
{
  "type": "capcut-david/catalogue@1",
  "entries": [
    {
      "id": "7517472189348695297",
      "kinds": ["font"],
      "names": ["Rubik-Bold"],
      "resource_id": "7517472189348695297",
      "effect_id": null,
      "font_paths": [],
      "first_seen": "2026-08-07",
      "witness_drafts": ["n_chat-dort-a-tes-pieds"],
      "note": "",
      "ignored": false,
      "merged_from": []
    }
  ]
}
```

### `id` — la clé durable

Dans l'ordre : `resource_id`, sinon `effect_id`, sinon `local:<font_path
normalisé>` (séparateurs en `/`, casse repliée) pour une police locale, sinon
`unresolved:<kind>|<name>`.

**Le nom n'entre jamais dans une clé durable.** Les entrées `unresolved:` sont
explicitement non durables.

Conséquence assumée : deux ressources distinctes dépourvues **à la fois** de
`resource_id` et d'`effect_id` et portant le même nom sont indiscernables dans la
donnée — elles fusionnent, et c'est correct. Dès qu'un `effect_id` existe il sert
de clé (rang 2), ce qui suffit à séparer le cas réel observé : deux effets à
`resource_id` vide, `effect_id` distincts, même nom.

`kind` **n'est pas** dans la clé : c'est un artefact de routage. Un même filtre
atterrit dans `materials.video_effects` (`kind: effect`) quand cutcli l'a écrit, et
dans `materials.effects` (`kind: filter`) quand CapCut UI l'a écrit. La
bibliothèque contient les deux époques. `kinds` est donc un ensemble observé.

`names` est un ensemble, pas une valeur : le même `resource_id` revient sous des
noms différents selon la locale du client qui a écrit le draft
(`6724919382104871427` = `Fade Out` dans une fixture, `渐隐` dans une autre).
Normalisé NFC, trié en points de code.

### Champs de l'humain

`note` (texte libre) et `ignored` (booléen) sont écrits par l'humain. Aucun sync ne
les modifie jamais.

`ignored: true` remplace la suppression : effacer une ligne à la main ne suffit
pas, le sync la ressusciterait sans sa note tant qu'un draft témoin existe.

## 5. Fusion — `planCatalogueMerge(existing, scanned, today)`

Fonction **pure**, sans I/O ni horloge. `today` est injecté (motif
`SyncOptions.nowMs` de `sync-timelines.ts:84`).

`first_seen` est une date **UTC** (`new Date(nowMs).toISOString().slice(0,10)`),
pas locale : un sync à 00h30 CET est donc estampillé de la veille. Assumé et
documenté — c'est le prix d'un champ reproductible en test et identique sur toutes
les machines.

| Situation | Comportement |
|---|---|
| `id` inconnu | ajouté, `first_seen = today` |
| `id` connu | `names`, `kinds`, `font_paths`, `witness_drafts` unionnés ; `first_seen` conservé ; `note` / `ignored` intouchés |
| `ignored: true` | l'entrée est passée telle quelle ; jamais ré-alimentée, jamais ré-ajoutée |
| Police `local:` qui gagne un `resource_id` | **promotion** (voir ci-dessous) |
| Draft témoin supprimé | entrée conservée, témoin retiré de `witness_drafts` |
| Plus aucun témoin | entrée conservée, `witness_drafts: []` |
| Entrée absente du scan | conservée à l'identique |

### Promotion des polices

C'est le cas qui, non traité, **orpheline la note de l'utilisateur** :

> Jour 1 — une police installée localement est utilisée dans une caption. Pas de
> `resource_id`, clé `local:c:/.../cc-derstil.ttf`. David écrit sa note.
> Jour 30 — il choisit la même police depuis le catalogue CapCut. Elle porte
> maintenant un `resource_id` → nouvelle clé → nouvelle entrée, note vide.
> L'entrée annotée survit (append-only) mais est morte ; celle que tout le monde
> utilisera est vierge.

Règle : au moment de la fusion, si une entrée scannée porte un `resource_id` et
qu'une entrée existante en `local:` partage un `font_path` normalisé **ou** un nom
NFC, les deux fusionnent dans l'entrée porteuse de l'id. La `note` et le
`first_seen` le plus ancien suivent ; la clé `local:` abandonnée est consignée dans
`merged_from`.

Reprend le motif `catalogueGrade()` de `make-preset.ts:75-79` (« si une entrée
catalogue et une entrée locale partagent le même titre, l'entrée catalogue gagne :
la locale est un repli, pas une police distincte »).

## 6. Écriture

- **Catalogue existant illisible → exit 2, aucune écriture.** Un repli sur un
  catalogue vide effacerait toutes les notes en silence. C'est la règle la plus
  importante du dispositif.
- Écriture atomique : fichier `.tmp` dans le même dossier puis `renameSync`. Une
  reprise sur `EPERM`/`EBUSY` (Obsidian ou un client de synchro peut tenir le
  fichier sous Windows), puis échec bruyant — jamais de repli sur une écriture
  tronquée.
- Relecture + refusion juste avant le `rename` : ferme la fenêtre où l'humain
  écrit une note pendant qu'un sync tourne.
- Sérialisation : `entries` trié par `id` en **points de code** (jamais
  `localeCompare`, dont le résultat dépend de la locale hôte et du build ICU),
  `JSON.stringify(x, null, 2)` + `\n` final.
- Lecture : BOM `\uFEFF` retiré, `\r\n` normalisé en `\n` avant parse.
- **Un sync sans nouveauté produit un fichier octet pour octet identique** — diff
  git vide.

### Garde-fous d'écriture

- La résolution du chemin n'a lieu **que** dans la commande, jamais dans la
  fonction pure. Tous les tests passent un `--catalogue` en dossier temporaire.
- L'écriture est **refusée** si le root de drafts résolu est sous `test-fixtures/`.
  Sans ça, `node --test` — lancé depuis le repo, qui est *sous* le vault — ferait
  remonter l'ancre jusqu'au vrai `Shared/capcut-catalogue.json` et y injecterait
  les fixtures, définitivement.

## 7. Surface CLI

```
catalogue [--kind <k>] [--sync] [--dry-run] [--drafts <dir>] [--catalogue <path>]
```

| Flag | Effet |
|---|---|
| *(aucun)* | lecture seule : affiche le catalogue. `-H` en table, JSON sinon |
| `--kind <k>` | restreint à `effect \| filter \| transition \| font` (filtre sur `kinds`) |
| `--sync` | moissonne les drafts, fusionne, écrit, rapporte les entrées ajoutées |
| `--dry-run` | avec `--sync` : rapporte sans écrire |
| `--drafts <dir>` | root de la bibliothèque à scanner |
| `--catalogue <path>` | chemin du fichier, outrepasse la résolution par ancre |

- `--catalogue` est validé comme `--transform-y` (`index.ts:323-329`) : valeur
  obligatoire, forme `--catalogue=<x>` refusée. `parseFlags` ne rejette pas les
  flags inconnus — sans cette garde, un `--catalog` mal tapé écrirait
  silencieusement au chemin par défaut.
- Enveloppe JSON `type: "capcut-david/catalogue@1"`, émise via `out()` pour que
  `--quiet` fonctionne.
- Exits : `0` succès (y compris zéro nouveauté) ; `2` opérationnel (root de drafts
  absent, tous les drafts illisibles, catalogue existant illisible) ; `1` usage,
  via `die()`.
- Enregistré dans `src/capabilities.ts` — `test/capabilities.test.mjs` vérifie la
  parité entre le registre et les verbes réellement dispatchés. `readOnly: false`,
  `capcutClosed: false`.
- **Pas** ajouté à `WRITE_COMMANDS` (`capcut-guard.ts`) : ce garde protège les
  *drafts* de l'écrasement par CapCut à la fermeture, et bloquer un sync pendant
  que CapCut est ouvert interdirait le moment exact où l'on veut capturer une
  ressource qu'on vient de découvrir.
- Mais **avertir si CapCut tourne** (`isCapCutRunning()`) : CapCut garde le draft
  en mémoire et ne l'écrit qu'à la sauvegarde. Un sync lancé juste après avoir
  appliqué un effet ne capture rien, et l'utilisateur conclurait que le catalogue
  est complet.

## 8. Correctif adjacent

`query.ts:246` fait un `JSON.parse` nu et avale l'exception (`:248`). Un draft
écrit par PowerShell porte un BOM (`test/bom.test.mjs` existe pour ça) et devient
**invisible au scan** : le catalogue sous-rapporte en silence. `draft.ts:111` sait
déjà retirer le BOM. Le scan de `catalogue --sync` et celui de `query` partagent la
correction — une ligne, deux verbes réparés.

## 9. Tests

Fonction pure `planCatalogueMerge` — l'essentiel s'y teste sans I/O :

1. `id` inconnu → ajouté avec `first_seen = today`
2. `id` connu → `note` préservée mot pour mot
3. `witness_drafts` unionné, sans doublon, trié
4. draft témoin disparu → entrée conservée, `witness_drafts` vidé
5. `ignored: true` → jamais ré-ajouté, même avec un témoin vivant
6. **promotion** : `local:` + note, puis même police avec `resource_id` → **une**
   entrée, note conservée, `merged_from` renseigné
7. même `resource_id` sous deux noms → une entrée, `names` à deux éléments
8. deux ressources à `resource_id` vide mais `effect_id` distincts, même nom →
   deux entrées (clé = `effect_id`), aucun `effect_id` perdu
9. filtre vu via `video_effects` puis via `effects` → une entrée, `kinds` à deux
   éléments
10. sync sans nouveauté → sortie **octet pour octet** identique (accents NFC/NFD,
    tri en points de code)

CLI :

11. catalogue existant corrompu → exit 2, fichier **inchangé sur disque**
12. `--dry-run` → rapporte, n'écrit rien
13. `--catalogue` sans valeur / forme `=` → exit 1
14. `--kind` filtre la sortie
15. root de drafts sous `test-fixtures/` → écriture refusée

## 10. Ce qui a été écarté

- **Moissonner `rp.db`** — hors périmètre (§2). La source est documentée ; y
  revenir ne casserait pas le format.
- **Résolution par nom dans les verbes `add-*`** — les agents composent ces
  commandes et liront le catalogue directement.
- **Un verbe `catalogue prune`** — `ignored` couvre le besoin pour un booléen.
- **Verrou multi-processus** — deux syncs concurrents perdent au pire des
  `witness_drafts`, réajoutés au run suivant. La relecture-avant-rename protège
  déjà les notes, seule donnée irremplaçable.
