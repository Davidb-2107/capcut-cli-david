# Élargir `--kind` : le catalogue ne connaît que 4 des ~7 familles CapCut

Statut : ✅ CLOS — implémenté 2026-08-09 (kinds `sticker`, `mask`, `animation`,
`curve`, dans `query` comme `catalogue`). Plan : `.claude/plans/traitons-le-chantier-est-buzzing-duckling.md`.
Ouvert : 2026-08-07 · Contexte : suite immédiate de v2.6.0 (`catalogue`) + `--add`

## Le problème, tel qu'il s'est manifesté

Après avoir livré `catalogue --add`, un scan de `~/.claude/skills` + du vault a
cherché tous les `resource_id` cités dans la doc mais absents du catalogue
(script jetable : `<vault>/temp/scan_resource_ids.py`, à refaire plutôt qu'à
retrouver — un id CapCut a exactement la forme d'un id de vidéo TikTok, d'où un
filtrage par contexte).

Trois ressources RÉELLES sont ressorties **inentrables**, faute de `kind` :

| ressource | id | où elle est documentée |
|---|---|---|
| Cubic Out (courbe de keyframe) | `7034098919583781377` | `Projects/Psycho/cutcli-keyframe-curves.md` |
| sticker « Simple Artistic Circle » | `7237287015903972613` | `docs/draft-schema/04-effects-filters-stickers.md` |
| animation de catalogue | `6724916044072227332` | `docs/draft-schema/03-keyframes-and-animations.md` |

`KINDS` (`src/commands/catalogue.ts`) et `QueryKind` (`src/commands/query.ts`)
n'acceptent que `effect | filter | transition | font`. Le masque
`7374021188315517456` (Circle) est dans le même cas. À noter — correction
adversariale en cours d'implémentation : `6706773528277946894` (cité ici comme
masque dans la version d'origine) est en réalité le **filter** « Vintage »,
dont `effect_id` égale `resource_id` — il était déjà extractable, pas besoin de
`--add` pour lui.

## Ce qu'on sait déjà du terrain

`extractItems` (`src/commands/query.ts:86`) lit aujourd'hui :
- `materials.effects[]` — partition `type === "filter"` → filter, sinon effect
- `materials.video_effects[]` → effect
- `materials.transitions[]` → transition
- `materials.texts[].fonts[].title` → font (fallback `texts[].font_path` = police locale)

Les familles manquantes vivent ailleurs. ~~`materials.masks[]`~~ — la liste
ci-dessous était à vérifier sur un vrai draft ; **vérifiée (2 fois, dont une
adversariale), elle est fausse sur trois points** :

| famille | chemin JSON réel | fixture témoin | clé durable | nom |
|---|---|---|---|---|
| sticker | `materials.stickers[]` | `stickers-draft` | `resource_id` | `name` + `category_name` |
| mask | `materials.common_mask[]` ⚠️ singulier, jamais `masks` | `masks-filters-draft` | `resource_id` | `name` (`category_name` = `""`) |
| animation | `materials.material_animations[].animations[]` ⚠️ **doublement imbriqué** | `animations-draft`, `full-psycho` | `resource_id` | `name` |
| curve | `keyframe_graph_list[]` ⚠️ **racine, pas `materials`** | `effects`, `ken-burns`, `full-psycho` | `resource_id` | `resource_name` ⚠️ |

Corrections : `materials.masks[]` **n'existe pas** → `common_mask` (singulier) ;
`materials.material_curves` **n'existe pas** → les courbes sont un tableau de
premier niveau `keyframe_graph_list[]` (les keyframes le référencent par
`graphID` → `keyframe_graph_list[].id`, un UUID local, PAS un id catalogue) ;
les animations ne sont pas imbriquées par segment mais dans un wrapper plat
(`{id, type:"sticker_animation", animations[]}`) lié au segment par
`extra_material_refs[]`, les `resource_id`/`name` vivant dans le tableau
**interne** ; les entrées à `id: ""` sont des **slots vides** (leur
`resource_id` porte un autre identifiant que celui de l'animation) → ignorées.

## Le vrai partage du travail

- **Côté `--add`** : trivial. Élargir `KINDS`, c'est une ligne. Aucune lecture de draft.
- **Côté `--sync`** : c'est le chantier. Il faut apprendre à `extractItems` à lire
  chaque famille, et chaque famille a sa forme (les animations sont imbriquées par
  segment, pas dans un tableau plat de materials ; les courbes portent un `id`
  catalogue et pas forcément un `resource_id`).

## Questions ouvertes — à trancher au brainstorm, pas ici

1. **Une seule liste de kinds, ou deux ?** `query` et `catalogue` la partagent
   aujourd'hui. On peut vouloir `--add` plus permissif que `--sync` (entrer une
   famille qu'on ne sait pas encore moissonner) — au prix d'une asymétrie visible.
2. **`catalogueId` tient-il pour ces familles ?** Il suppose `resource_id ||
   effect_id || local:<path> || unresolved:<kind>|<nom>`. Une courbe de keyframe
   a-t-elle un `resource_id` ? Si non, quelle est sa clé durable ?
3. **Rétro-compatibilité du fichier.** Le catalogue réel est versionné et porte
   déjà des notes humaines. Une nouvelle valeur de `kinds[]` doit être lisible par
   la version précédente (elle l'est : `kinds` est un `string[]` libre) — mais un
   `--kind` inconnu doit-il rester une erreur d'usage ? Probablement oui.
4. **Est-ce que ça vaut le coup pour `--sync` ?** Peut-être que seul `--add`
   mérite l'élargissement, et que les stickers/animations n'ont jamais besoin
   d'être moissonnés automatiquement. À décider sur usage réel, pas par symétrie.

## Décision NON prise dans la session d'origine

L'import des 10 ressources déjà entrables (VHS Horror, Analog Horror, HD Dark,
Gritty Noir, Dark Tones, Blue Hour, Cinematic Dusk, Bronze Gray, Western,
Black Fade) a été proposé et laissé en suspens. Il ne dépend PAS de ce chantier :
ces 10-là passent par `--add` tel qu'il existe. Les id sont dans
`Projects/CapCut-Assembler/scripts/effects/README.md` et `src/capabilities.ts`.
Provenance = doc, pas un draft relu → toute note doit le dire.
