# Tout le moteur `capcut-david` expliqué comme si tu avais 5 ans

> Un récap tout simple de **tout ce qu'on a construit** (versions 1.7 → 1.14).
> Pour le détail technique : voir le [`CHANGELOG`](../CHANGELOG.md) et les
> [`release-notes/`](../release-notes/). Pour trois commandes en détail :
> [`validate-fix-explained.md`](./validate-fix-explained.md),
> [`query-explained.md`](./query-explained.md) et
> [`make-preset-explained.md`](./make-preset-explained.md).

## C'est quoi `capcut-david` ?

Ta vidéo TikTok, pour l'ordinateur, c'est une **grosse boîte de LEGO** avec une
**notice** (un fichier `draft_content.json`). CapCut lit cette notice pour montrer
ta vidéo.

`capcut-david`, c'est une **boîte à outils de robots** 🤖 qui rangent, vérifient et
réparent cette boîte de LEGO **sans ouvrir CapCut**. Comme ça, quand tu ouvres
CapCut à la fin, tout est déjà nickel.

---

## Les robots qu'on a construits (dans l'ordre)

### 🔧 1.7.0 — On a réparé deux gros pièges (« engine hardening »)
Avant, le robot se trompait de chemin sur Windows (il cherchait les LEGO au
mauvais endroit) et il acceptait d'écrire dans la boîte **pendant que CapCut était
ouvert** — et CapCut écrasait tout en se fermant. 😱
On a réparé les deux : les chemins marchent partout, et maintenant **si CapCut est
ouvert, le robot refuse de toucher la boîte** (sauf si tu insistes avec `--force`).

### 🔍 1.8.0 — `validate` : le robot qui **regarde** (mais ne touche pas)
Il inspecte la boîte et te dit : « attention, y'a un morceau qui pointe vers une
pièce qui n'existe pas », « celle-là, personne ne s'en sert », « il manque
l'étiquette »… Il **ne répare rien**, il **dit** juste les problèmes. C'est le
**détecteur**. (Et comme il ne touche à rien, on peut le lancer même CapCut ouvert.)

### 🔄 1.9.0 — `sync-timelines` : le robot **photocopieur**
Quand CapCut ouvre ta boîte, il fait une **photocopie** à côté (un dossier
`Timelines/`). Si tu modifies la vraie boîte après, la photocopie est **périmée** et
CapCut affiche le vieux truc. Ce robot **recopie** la vraie boîte dans la photocopie.
Et il garde toujours une **sauvegarde** au cas où. Il répare le problème «
photocopie périmée » que `validate` repère.

### 🗑️ 1.10.0 — `gc` : le robot **poubelle**
Il jette les pièces LEGO qui **traînent et que personne n'utilise** (les morceaux de
texte oubliés à chaque fois qu'on remet les sous-titres). On a vérifié **très fort**
(sur 1283 pièces dans nos exemples) qu'aucune pièce « inutilisée » n'est en fait
reliée à une autre en secret — donc les jeter ne casse jamais rien. Et **si la boîte
est cassée, il refuse d'y toucher**.

### 🏷️ 1.11.0 — `init-meta` : le robot **étiqueteur**
Si l'**étiquette** de la boîte a disparu (le fichier `draft_meta_info.json`), CapCut
ne voit même pas la boîte. Ce robot **refait l'étiquette**. Et attention : si une
étiquette existe **déjà**, il n'y touche **pas** (elle est peut-être la vraie !) —
sauf si tu dis `--force`.

### 🤖 1.12.0 — `validate --fix` : le **chef des robots**
Au lieu d'appeler chaque robot à la main, le chef **lit la liste de `validate`** et
appelle **le bon robot pour chaque problème, tout seul**, dans le bon ordre :

```
gc → init-meta → register → sync-timelines
```

(nettoyer → étiqueter → inscrire sur la liste → photocopier). Il montre d'abord ce
qu'il **VA** faire (« pour de faux »), et tu dis `--apply` pour de vrai.
→ Détails : [`validate-fix-explained.md`](./validate-fix-explained.md)

### 🔎 1.13.0 — `query` : le robot **bibliothécaire**
Le premier robot qui **cherche** des choses. Tu lui dis un **nom** (un effet, un
filtre, une transition, une police) et il te trouve le **numéro secret**
(`resource_id`) en fouillant dans toutes tes boîtes. Comme un moteur de recherche
pour tes LEGO.

### 🅰️ 1.14.0 — `make-preset` : le robot **fabricant de modèles**
Le cousin du bibliothécaire. Tu lui dis le **nom d'une police** que tu as déjà
utilisée, et il te fabrique un **petit modèle tout prêt** (un « preset ») pour
réappliquer cette police à **tous** tes sous-titres d'un coup avec `restyle`. Avant,
il fallait écrire ce modèle à la main en allant chercher le numéro secret, le chemin
du fichier de police, l'étiquette… la galère. Maintenant le robot **lit tout ça dans
tes boîtes** et te donne le modèle clé en main.
→ Détails : [`make-preset-explained.md`](./make-preset-explained.md)

### 🩹 1.14.1 — `sync-timelines` devient plus malin (réparation)
On a découvert que CapCut fait en fait **deux photocopies**, pas une ! Quand tu
construis une boîte **sans jamais ouvrir CapCut**, la photocopie qu'il regarde **en
tout premier** s'appelle `draft_info.json` — et notre photocopieur (1.9.0) ne la
recopiait **pas**. Résultat : tu ajoutais la **musique** et les **sous-titres** dans
la vraie boîte, mais en ouvrant CapCut ils **disparaissaient** ! 😱 On l'a prouvé en
vrai sur une boîte cassée, puis réparé : maintenant le robot recopie **aussi** cette
première photocopie, donc tout est bien là dès la première ouverture. (La photocopie
qu'il lit en premier reçoit enfin la musique et les sous-titres.)

---

## L'idée géniale : détecteur + réparateurs 🧩

Le truc malin, c'est que tout marche **ensemble** :

| `validate` voit ce problème… | …et ce robot le répare |
|---|---|
| photocopie périmée (`timelines.divergence`) | 🔄 `sync-timelines` |
| pièces qui traînent (`orphan_text` / `orphan_media`) | 🗑️ `gc` |
| étiquette manquante (`meta.missing`) | 🏷️ `init-meta` |
| boîte pas sur la liste (`meta.unregistered`) | ✋ `register` |

Et `validate --fix`, c'est le **chef** qui fait tout ça automatiquement. 🎉

---

## Comment on a travaillé (pour que ce soit solide) 🛡️

Pour **chaque** robot, on a fait pareil :
1. 🧠 On a **réfléchi à plusieurs cerveaux** au design (un atelier d'idées).
2. 😼 On a fait relire par un **robot grincheux** qui essaie de tout casser, pour
   trouver les pièges **avant** de livrer. (Une fois, il a trouvé un vrai bug : un
   bout d'étiquette qui avait disparu sans qu'on le voie !)
3. ✅ On a écrit les **tests d'abord** (on vérifie que ça rate, puis on le fait
   marcher). À la fin : **464 vérifications** qui passent.
4. 🚀 On a livré pour de vrai (sur internet), à chaque fois avec ta permission.

---

**En résumé :** on est parti d'un robot qui **regarde** (`validate`), et on lui a
construit **toute une équipe de robots réparateurs** + un **chef** qui les
coordonne + un **bibliothécaire** qui cherche + un **fabricant de modèles**. Et on a
rendu le **photocopieur** assez malin pour ne plus jamais perdre ta musique ni tes
sous-titres. Tout ça pour que ta boîte de LEGO soit toujours nickel **avant**
d'ouvrir CapCut. 🎬✨
