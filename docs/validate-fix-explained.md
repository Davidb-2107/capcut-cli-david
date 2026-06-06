# `validate --fix` expliqué comme si tu avais 5 ans

> Un explainer tout simple de ce que fait `validate --fix` (v1.12.0) et des
> pièges qu'on a attrapés avant de le livrer. Pour la doc technique complète,
> voir [`release-notes/1.12.0.md`](../release-notes/1.12.0.md) et le `CHANGELOG`.

Imagine que ta vidéo, c'est une **grosse boîte de LEGO** avec une notice. Des
fois la notice a des petits problèmes. On a un robot qui s'appelle **`validate`** :
il regarde la boîte et dit « attention, y'a 3 trucs pas bien ici ». Mais avant,
il savait seulement **dire** les problèmes, pas les réparer.

Maintenant on a construit le **chef des robots** : `validate --fix`. 🤖

## Les 4 petits robots réparateurs

Chacun nettoie **un seul type** de bêtise :

- 🗑️ **gc** — jette les pièces LEGO qui traînent et que **personne n'utilise**
  (des morceaux oubliés).
- 📋 **init-meta** — si l'**étiquette** de la boîte a disparu (du coup l'ordinateur
  ne voit même pas la boîte), il en refait une.
- ✋ **register** — il **inscrit la boîte sur la liste** pour qu'elle apparaisse
  dans l'appli.
- 🔄 **sync-timelines** — quand la vraie boîte a changé, il **recopie** les
  changements dans la petite boîte-photocopie à côté.

Le **chef** regarde la liste de `validate` et appelle le bon robot pour chaque
problème. Tout seul. 🎉

## Pourquoi l'ordre est super important (l'histoire)

Tu **ne peux pas** inscrire la boîte sur la liste (`register`) **avant** d'avoir
collé l'étiquette (`init-meta`) — sinon le robot pleure parce qu'il n'y a pas
d'étiquette à lire. 😢

Et le robot photocopieur (`sync-timelines`) doit passer **en DERNIER** : sinon il
recopie la boîte **avant** qu'on l'ait nettoyée, et la photocopie est déjà
périmée.

Donc l'ordre est **toujours** : nettoyer → étiqueter → inscrire → photocopier.

```
gc → init-meta → register → sync-timelines
```

## Le bouton « pour de faux » d'abord 🎮

Comme un des robots **jette des pièces pour de vrai**, le chef fait d'abord
**« regarde, voilà ce que je VAIS faire »** sans rien toucher. Tu dis `--apply`
seulement quand tu es d'accord. Comme un brouillon avant le vrai dessin.

```
capcut-david validate ma-boîte --fix            # pour de faux (montre le plan)
capcut-david validate ma-boîte --fix --apply    # pour de vrai (répare)
```

## Les pièges qu'on a attrapés AVANT qu'ils fassent mal 🛡️

On a fait relire le plan par un **robot grincheux** (deux fois !) qui essaie de
tout casser. Il a trouvé des pièges cachés :

- 🚨 **Le plus dangereux (B1) :** si la boîte a **deux pièces avec le même nom**,
  le robot poubelle pourrait jeter **les deux** par erreur (alors qu'une est
  utilisée !). → On a dit : **si la boîte est cassée, on ne touche à RIEN** et on
  prévient.
- 😶 **Le sournois (B3) :** le robot photocopieur, quand il ratait, **ne criait
  pas** — il faisait semblant que tout allait bien. → Maintenant on **écoute s'il
  a raté** et on s'arrête.
- 🤔 **Le piège du « tout va bien » (B7) :** quand le robot poubelle a fini, le
  feu reste **vert** même s'il n'a rien jeté. Donc on ne peut pas se fier juste au
  feu vert — on **vérifie vraiment** que les pièces sont parties.
- 🙅 **Le bouton qui se contredit (B5) :** si tu demandes « pour de faux » **et**
  « pour de vrai » en même temps, le chef dit « non, choisis ! » au lieu de faire
  n'importe quoi.
- 🏷️ **L'étiquette qui change toute seule (B2) :** des fois le robot qui inscrit
  la boîte lui donne un **nouveau numéro** — on a vérifié que la boîte et la liste
  gardent **le même numéro** à la fin.
- 📂 **La boîte sans tiroir (B6) :** si tu pointes juste **un papier** au lieu de
  la **boîte entière**, seuls certains robots peuvent travailler — le chef te le
  dit gentiment au lieu de planter.

## Et à la fin ?

Le chef **re-regarde la boîte** pour vérifier que les problèmes sont vraiment
partis, et te fait un petit rapport. ✅

---

**En résumé :** on a appris au chef-robot à appeler les bons robots, dans le bon
ordre, en mode brouillon d'abord, en refusant de toucher une boîte cassée — et on
l'a livré pour de vrai (399 vérifications passées). 🚀
