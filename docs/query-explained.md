# `query` expliqué comme si tu avais 5 ans

> Un explainer tout simple de ce que fera `query` (v1.13.0, en cours) : une
> baguette de recherche pour retrouver le **numéro magique** d'une pièce de
> montage par son **nom**. Spec technique complète : voir `QUERY-kickoff.md`
> (racine du repo) — et plus tard le `CHANGELOG` + `release-notes/1.13.0.md`.

Imagine que tu as une **énorme boîte de LEGO** pour faire des petites vidéos
(c'est CapCut). Dedans il y a plein de pièces spéciales :

- ✨ des **effets** (l'image qui tremble, qui brille)
- 🟡 des **filtres** (l'image qui devient vieille, jaune)
- 🌫️ des **transitions** (le passage doux entre deux images)
- ✍️ des **polices** (la forme des lettres pour écrire)

## Le problème

Chaque pièce a un **nom secret en chiffres** super long, genre
`6724846004274729480`. Pour mettre la pièce « Dissolve » dans ta vidéo,
l'ordinateur a besoin de ce numéro magique. Mais toi, tu connais juste le
**nom** (« Dissolve »), pas le numéro. Aujourd'hui, il faut **deviner** →
galère. 😣

## La solution : une baguette de recherche 🪄

On fabrique une commande qui s'appelle **`query`** (= « cherche »).

Tu lui dis un mot :

```
capcut-david query dissolve
```

Et elle va **fouiller dans tous tes anciens projets vidéo** (toutes les fois où
tu as déjà utilisé des pièces), et elle te répond :

> « Trouvé ! 🎉 *Dissolve* c'est une **transition**, son numéro magique c'est
> `6724846004274729480`, et tu l'avais utilisée dans le projet
> *transitions-draft*. »

Comme un **moteur de recherche** dans ta propre boîte de LEGO. 🔍

## Les règles importantes

- 👀 **Elle regarde, elle ne casse rien.** C'est juste de la lecture. Elle ne
  touche jamais à tes vidéos *(read-only)*.
- 🟢 Si elle trouve → elle te donne le numéro. Si elle trouve rien → elle dit
  « rien trouvé » gentiment (ce n'est pas une erreur).
- 🅰️ Tu peux dire « cherche seulement parmi les **polices** » pour filtrer :
  `capcut-david query playfair --kind font`.
- 📦 Plusieurs projets utilisent la même pièce ? Elle la montre **une seule
  fois** et te dit dans **quels projets** elle est rangée.

## Pourquoi tout ce travail avant de coder

Avant de construire la baguette, on a envoyé plein de petits robots 🤖 vérifier
que le plan colle à la **vraie** boîte de LEGO — parce qu'une baguette qui donne
le **mauvais numéro** serait pire que pas de baguette du tout. Une fois le plan
**vérifié et solide**, on la construit.

**En une phrase :** `query` ajoute un bouton « cherche une pièce par son nom et
récupère son numéro magique » pour que tu arrêtes de deviner. 🪄✨
