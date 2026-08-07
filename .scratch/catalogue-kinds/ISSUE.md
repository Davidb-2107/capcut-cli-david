# Élargir `--kind` : le catalogue ne connaît que 4 des ~7 familles CapCut

Statut : `ready-for-agent` (à brainstormer puis spécifier — RIEN n'est décidé ici)
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
n'acceptent que `effect | filter | transition | font`. Les masques
(`7374021188315517456`, `6706773528277946894`) sont dans le même cas.

## Ce qu'on sait déjà du terrain

`extractItems` (`src/commands/query.ts:86`) lit aujourd'hui :
- `materials.effects[]` — partition `type === "filter"` → filter, sinon effect
- `materials.video_effects[]` → effect
- `materials.transitions[]` → transition
- `materials.texts[].fonts[].title` → font (fallback `texts[].font_path` = police locale)

Les familles manquantes vivent ailleurs (`materials.stickers[]`,
`materials.masks[]`, les animations dans `material_animations`, les courbes dans
`material_curves` — À VÉRIFIER sur un vrai draft, ne pas croire cette liste).

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
