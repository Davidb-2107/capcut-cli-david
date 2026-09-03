# `cascade-words` — calibration CapCut des métriques de police

**Statut : RENDU EXPORTÉ ANALYSÉ — adaptation kerning provisoire testée,
calibration CapCut numérique encore non validée au 2026-09-03.**

Ce document est le verrou de traçabilité du plan. Le CLI a préparé les drafts
témoins, CapCut a persisté
les polices dans les deux projets, puis les deux exports MP4 ont été analysés
localement avec `ffmpeg` le 2026-09-03. Le rendu exporté donne une mesure de
l’encre visible et du clipping, mais pas directement l’avance typographique
complète. Aucune constante empirique de conversion ne doit donc être ajoutée
au code ou présentée comme validée.

## Sondes préparées le 2026-09-03

Deux drafts temporaires ont été créés et enregistrés dans l’index local CapCut,
sans média versionné :

- portrait `1080×1920` : `cascade-words-font-calibration-portrait-2026-09-03` ;
- paysage `1920×1080` : `cascade-words-font-calibration-landscape-2026-09-03`.

Chaque draft contient les 12 cas suivants, sur des segments consécutifs de deux
secondes : `AVATAR`, `this is the second` et `fi office`, pour les tailles 20 et
40, avec les familles `Rubik-Bold` et `Pricedown Bl`. Les identifiants comme
`rubik-20-avatar` sont des repères du protocole uniquement : les pistes ne sont
pas nommées ainsi dans l’interface CapCut.

Polices résolues dans le dossier de drafts local :

- `Rubik-Bold`, resource ID `7517472189348695297`,
  `C:/Users/dbele/AppData/Local/CapCut/User Data/Cache/effect/7517472189348695297/d9b01b0f3c2256a42fbf4ba926aaeeb8/Rubik-Bold.ttf` ;
- `Pricedown Bl`, police locale sans resource ID,
  `C:/Users/dbele/AppData/Local/Microsoft/Windows/Fonts/Pricedown Bl.otf`.

La structure initiale exposait `line_max_width = 0.82`, `fixed_width = -1`,
`fixed_height = -1`, `letter_spacing = 0` et `typesetting = 0`. Après passage
dans CapCut et sauvegarde, les deux drafts contiennent bien :

- `materials.texts[0..5]` avec `font_size` 20/40 et le chemin persisté vers
  `Rubik-Bold.ttf` ;
- `materials.texts[6..11]` avec `font_size` 20/40 et le chemin persisté vers
  `Pricedown Bl.otf` ;
- `fixed_width = -1`, `fixed_height = -1`, `line_max_width = 0.82`,
  `letter_spacing = 0` et `typesetting = 0`.

Le champ natif `text_size` vaut `30` dans les 12 matériaux, alors que
`font_size` porte bien les valeurs de sonde 20/40. Cette coexistence doit être
confrontée au rendu avant de décider quel champ représente la taille effective
pour la calibration.

Les deux exports ont ensuite été analysés à leur résolution native. Les frames
de contrôle sont prises au milieu de chacun des 12 segments de deux secondes,
aux timestamps `1, 3, 5, …, 23 s`.

## Sonde incrémentale Rubik créée par le CLI le 2026-09-03

Une sonde ciblée a ensuite été générée directement par le checkout
`codex/cascade-words-integration`, afin d’isoler l’avance d’un glyphe sans
risque de clipping :

- draft : `C:/Users/dbele/AppData/Local/CapCut/User Data/Projects/com.lveditor.draft/cascade-words-font-calibration-rubik-2026-09-03` ;
- canvas : `1080×1920`, 30 fps, durée globale `6 s` ;
- piste unique : `rubik-calibration` ;
- six captions contiguës d’une seconde, toutes en taille CapCut `10` :
  `AAAA`, `AAAAAAAA`, `WWWW`, `WWWWWWWW`, `iiii`, `iiiiiiii` ;
- police appliquée par le couple CLI `make-preset` → `restyle` :
  `Rubik-Bold`, resource ID `7517472189348695297`, avec le chemin catalogue
  `.../effect/7517472189348695297/.../Rubik-Bold.ttf`.

La création a utilisé `init`, `add-text`, puis `import-captions` pour recalculer
la durée globale, suivis de `init-meta --register`, `restyle` et `gc`. Le
contrôle final par `info` et `validate` confirme `6` segments, `6` matériaux
texte actifs, `0` erreur, `0` warning et `0` finding. Le preset temporaire a
été écrit hors du dépôt ; le fichier JSON de captions temporaire a été supprimé
après utilisation.

### Contrôle de l’export Rubik CLI reçu le 2026-09-03

L’export `cascade-words-font-calibration-rubik-2026-09-.mp4` a été contrôlé
avec `ffprobe` et les frames ont été extraites avec la version locale de
`ffmpeg`, à la résolution native `1080×1920` et à `2 fps`. La vidéo dure
`6,014 s`, contient six segments d’une seconde et les frames centrales des six
captions ont été retenues pour la mesure.

La sonde est rejetée comme donnée de calibration : deux captions touchent les
deux bords du canvas et sont donc tronquées. La bounding box d’encre, mesurée
avec un seuil de luminance de `24/255`, donne :

| Caption | `fontkit` à 10 | Encre exportée | Clipping |
|---|---:|---:|---|
| `AAAA` | 28,72 px | 722 px | non |
| `AAAAAAAA` | 57,44 px | 1 080 px | oui |
| `WWWW` | 33,28 px | 830 px | non |
| `WWWWWWWW` | 66,56 px | 1 080 px | oui |
| `iiii` | 11,84 px | 58 px | non |
| `iiiiiiii` | 23,68 px | 572 px | non |

Les valeurs `fontkit` sont la somme des avances de glyphes Rubik-Bold façonnés
à `fontSize = 10`; aucune réduction de kerning n’apparaît dans ces six runs.
Les valeurs exportées sont des boîtes d’encre rasterisées, pas des avances
OpenType. Leur dispersion, ainsi que le clipping des deux chaînes longues,
interdit d’en déduire un facteur ou un profil validé. Le draft doit être
remplacé par une sonde qui tient entièrement dans le canvas (`AA/AAAA`,
`WW/WWWW`, `iiii/iiiiiiii`) puis exporté à nouveau avant toute conclusion.

## Références `fontkit` calculées le 2026-09-03

Avec `letterSpacing = 0`, le module intégré calcule les largeurs suivantes
avant toute constante d’échelle empirique CapCut :

| Police | Taille | `AVATAR` | `this is the second` | `fi office` |
|---|---:|---:|---:|---:|
| Rubik-Bold | 20 | 78,640 px | 176,820 px | 76,680 px |
| Rubik-Bold | 40 | 157,280 px | 353,640 px | 153,360 px |
| Pricedown Bl | 20 | 62,920 px | 159,260 px | 71,560 px |
| Pricedown Bl | 40 | 125,840 px | 318,520 px | 143,120 px |

Ces valeurs sont des références OpenType (`font.layout()` et `xAdvance`), pas
encore la calibration du moteur. La constante de conversion reste donc
provisoirement `1` dans l’adaptateur et ne doit pas être figée comme décision
CapCut tant qu’une largeur rendue correspondante n’a pas été relevée.

## Relevé visuel provisoire le 2026-09-03

Les captures CapCut avec la règle, les repères centrés et le rectangle de
sélection couvrent maintenant les 24 cas des deux drafts. Les valeurs ci-dessous
sont arrondies : elles servent à comparer les proportions, pas encore à valider
la tolérance finale de `2 px`.

| Canvas | Police | Taille | `AVATAR` | `this is the second` | `fi office` |
|---|---|---:|---:|---:|---:|
| `1080×1920` | Rubik-Bold | 20 | ~492 px | ~990 px | ~455 px |
| `1080×1920` | Rubik-Bold | 40 | ~984 px | ~1 970 px | ~910 px |
| `1080×1920` | Pricedown Bl | 20 | ~445 px | ~1 050 px | ~500 px |
| `1080×1920` | Pricedown Bl | 40 | ~886 px | ~2 090 px | ~1 000 px |
| `1920×1080` | Rubik-Bold | 20 | ~870 px | ~1 740 px | ~810 px |
| `1920×1080` | Rubik-Bold | 40 | ~1 740 px | ~3 510 px | ~1 620 px |
| `1920×1080` | Pricedown Bl | 20 | ~790 px | ~1 860 px | ~890 px |
| `1920×1080` | Pricedown Bl | 40 | ~1 580 px | ~3 720 px | ~1 780 px |

Le doublement entre les tailles 20 et 40 est confirmé visuellement. À taille
égale, le passage du canvas portrait au canvas paysage augmente également la
largeur d’environ `1920 / 1080`. Le facteur observé dépend donc au minimum du
canvas et semble aussi différer entre les deux polices.

Ces valeurs mesurent la boîte de sélection CapCut, non une largeur numérique
extraite du moteur. Comme la boîte peut inclure du padding ou une convention de
mise à l’échelle propre au moteur, elles ne suffisent pas encore à distinguer
l’avance typographique de la largeur de boîte ni à figer une constante de
production avec une erreur de `≤ 2 px`.

### Comparaison initiale avec `fontkit`

Après normalisation du canvas paysage par `1920 / 1080`, le rapport
`largeur_boîte / largeur_fontkit` varie selon la chaîne :

| Police | `AVATAR` | `this is the second` | `fi office` |
|---|---:|---:|---:|
| Rubik-Bold | ~6,24 | ~5,57 | ~5,94 |
| Pricedown Bl | ~7,06 | ~6,57 | ~6,99 |

Un ajustement linéaire `boîte = facteur × fontkit + padding`, séparé par
police, laisse encore une erreur maximale d’environ `63 px` pour Rubik et
`29 px` pour Pricedown sur les valeurs arrondies. La boîte de sélection n’est
donc pas une mesure suffisamment fidèle de l’avance `xAdvance` pour produire
la tolérance exigée. Aucun facteur ni padding empirique ne doit être ajouté au
code sur cette base.

**Décision intermédiaire :** les captures valident la proportionnalité par
taille et par largeur de canvas, mais pas la correspondance boîte ↔ avance
typographique. La prochaine étape doit obtenir une mesure native de largeur ou
un rendu exporté analysable, puis reprendre la comparaison.

### Vérification géométrique du JSON après sauvegarde

Les deux `draft_content.json` sauvegardés ont été inspectés. Ils exposent bien
`canvas_config.width` (`1080` et `1920`), mais aucun champ numérique de largeur
rendue ou de `bounding` pour les matériaux texte. Les matériaux conservent
`fixed_width = -1`, `fixed_height = -1`, `line_max_width = 0.82` et
`text_size = 30`; `font_size` contient les tailles de sonde 20/40. Les clips
texte ont `scale.x = 1`, `scale.y = 1`, `transform.x = 0` et `transform.y = 0`.

Le JSON ne fournit donc pas de mesure native plus précise que la boîte visible
dans l’éditeur. La calibration doit passer par un rendu exporté à la résolution
native, ou par une autre valeur numérique fournie directement par CapCut.

## Analyse des exports MP4 corrigés le 2026-09-03

Exports analysés :

- `C:/Users/dbele/AppData/Local/CapCut/Videos/cascade-words-font-calibration-portrait-2026-(1).mp4` ;
- `C:/Users/dbele/AppData/Local/CapCut/Videos/cascade-words-font-calibration-landscape-2026(1).mp4`.

Cette passe remplace la première passe exportée : dans celle-ci, les positions
4 et 10 avaient été mises par erreur en taille 10, tandis que les positions 5
et 11 restaient en taille 40. La passe corrigée conserve `AVATAR` en taille 40
et met `this is the second` en taille 10.

`ffprobe` confirme un flux vidéo H.264 de 24,000 s à 30 fps dans chaque
fichier, avec les résolutions natives `1080×1920` et `1920×1080`. Les frames
ont été extraites avec le binaire local :

`C:/Users/dbele/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe`

Le moteur testé correspond au checkout d’intégration `d09455a` du CLI
(`package.json` version `2.7.0`). La version exacte de CapCut n’est pas
encodée dans les MP4 et n’a pas été relevée séparément ; ce champ reste à
compléter avant un verdict de compatibilité durable.

La commande de contrôle est équivalente à :

```text
ffmpeg -ss 1 -i <export.mp4> -an -vf "fps=1/2" -frames:v 12 <frame-%02d.png>
```

Les 24 frames sont natives, text-only, sans interface CapCut ni aperçu social
incrusté. La boîte ci-dessous est la bounding box des pixels blancs/gris
visibles sur fond noir, avec un seuil de 24/255 ; elle ne comprend donc pas
les sidebearings ou les espaces invisibles et ne doit pas être confondue avec
`xAdvance`. Pour rendre la comparaison plus homogène, la table donne aussi la
bounding box vectorielle des glyphes fontkit du même run façonné, positionnés
avec les offsets et avances du layout.

| Cas | `fontkit` xAdvance | `fontkit` bbox vectorielle | Portrait encre | Paysage encre ramenée à 1080 | Encre / bbox fontkit | Clipping |
|---|---:|---:|---:|---:|---:|---|
| Rubik 20 `AVATAR` | 78,640 | 77,680 | 437 px | 435,9 px | 5,626 | non |
| Rubik 20 `this is the second` | 176,820 | 175,340 | 928 px | 927,6 px | 5,293 | non |
| Rubik 20 `fi office` | 76,680 | 75,600 | 401 px | 399,9 px | 5,304 | non |
| Rubik 40 `AVATAR` | 157,280 | 155,360 | 873 px | 871,9 px | 5,619 | non |
| Rubik 10 `this is the second` | 88,410 | 87,670 | 465 px | 464,1 px | 5,304 | non |
| Rubik 40 `fi office` | 153,360 | 151,200 | 800 px | 799,3 px | 5,291 | non |
| Pricedown 20 `AVATAR` | 62,920 | 61,920 | 389 px | 388,7 px | 6,282 | non |
| Pricedown 20 `this is the second` | 159,260 | 158,620 | 995 px | 994,5 px | 6,273 | non |
| Pricedown 20 `fi office` | 71,560 | 70,580 | 444 px | 442,7 px | 6,291 | non |
| Pricedown 40 `AVATAR` | 125,840 | 123,840 | 776 px | 776,2 px | 6,266 | non |
| Pricedown 10 `this is the second` | 79,630 | 79,310 | 498 px | 497,2 px | 6,279 | non |
| Pricedown 40 `fi office` | 143,120 | 141,160 | 886 px | 884,8 px | 6,277 | non |

Les rapports portrait/paysage sont cohérents : après normalisation par
`1080 / 1920`, l’écart maximal observé sur les cas non tronqués est d’environ
`1,3 px`. Le doublement entre les tailles 20 et 40 est également confirmé par
le rendu exporté.

### Comparaison et interprétation

Les 12 cas de la passe corrigée sont maintenant non tronqués. Sur ces cas, le
rapport entre l’encre visible et la bounding box
vectorielle fontkit est relativement stable pour Pricedown mais présente un
écart lié à la chaîne pour Rubik :

- Rubik-Bold : `5,291–5,626` ; `AVATAR` est nettement au-dessus des deux
  chaînes contenant des espaces ;
- Pricedown Bl : `6,266–6,291`, soit une dispersion faible sur les cas courts.

Cette différence ne constitue pas encore une constante de production. Elle
compare une bounding box d’encre rasterisée à une avance OpenType : les
sidebearings, les espaces, le clipping, l’anti-aliasing et le contour exact
utilisé par CapCut peuvent expliquer une partie de l’écart. Même en comparant
à la bbox vectorielle fontkit, la sonde Rubik `AVATAR` reste un cas divergent ;
cette dispersion est documentée mais ne suffit pas à ajuster un facteur de
production.

### Diagnostic kerning et ajustement provisoire

Un contrôle supplémentaire a comparé, sur les mêmes fichiers de police, la
somme des `xAdvance` issue du run façonné et la somme des `glyph.advanceWidth`
du même run sans appliquer les réductions de kerning. Pour Rubik-Bold à la
taille 20, `AVATAR` passe de `78,640 px` kerné à `83,520 px` non kerné, soit un
écart de `4,880 px` avant conversion CapCut. Les écarts correspondants sont
seulement `0,380 px` pour `this is the second` et `0,100 px` pour `fi office`.
Pricedown ne présente pas d’écart de kerning dans ces cas.

Un ajustement linéaire sans intercept sur les largeurs d’encre portrait donne
la matrice suivante :

| Police | Mesure fontkit comparée | Facteur ajusté | Erreur absolue maximale | RMSE |
|---|---|---:|---:|---:|
| Rubik-Bold | `layout().xAdvance` kerné | 5,334977 | 33,91 px | 18,84 px |
| Rubik-Bold | avance non kernée | 5,227633 | 2,76 px | 1,53 px |
| Pricedown Bl | `layout().xAdvance` | 6,210149 | 5,97 px | 3,85 px |
| Pricedown Bl | bbox vectorielle fontkit | 6,274655 | 1,13 px | 0,70 px |

Le passage à l’avance non kernée explique donc très bien l’anomalie Rubik et
ramène l’erreur proche de la cible. Il ne satisfait toutefois pas encore
strictement la tolérance de `≤ 2 px`, et la bbox vectorielle n’est pas
interchangeable avec l’avance utilisée pour le wrapping. L’hypothèse de
compatibilité CapCut « kerning ignoré pour Rubik » est forte ; elle est
désormais confirmée par la sonde minimale de paires (`AV`, `VA`, `AT`, `AA`).

### Portage provisoire dans le worktree d’intégration

Dans `codex/cascade-words-integration`, le module additionne les
`glyph.advanceWidth` des glyphes produits par `font.layout()`, au lieu des
`position.xAdvance` kernés. Le shaping reste actif et la ligature `fi` est
préservée. Le contrat est verrouillé par un test `AV` qui échouait avec
`xAdvance` (`24,84` contre `25,76` attendu), puis passe avec l’avance non kernée.

Le même worktree contient maintenant le contrat de profils explicites dans
`src/utils/font-calibration.ts`. La clé utilise d’abord `resource_id`, puis le
chemin de fichier normalisé ; un profil marqué `candidate` ou une police sans
profil validé est refusé explicitement. Les facteurs Rubik/Pricedown restent
donc des résultats expérimentaux du rapport, et aucune valeur n’est enregistrée
comme profil actif de production.

Le build et le test ciblé du module passent (`8/8`). Après restauration des
dépendances locales déplacées temporairement par une tentative `pnpm`, la suite
complète passe désormais `676/676`, y compris le contrat de profils. Le
worktree de sonde avait déjà passé `671/671` lors de la vérification précédente.
Cette modification reste provisoire : elle ne fixe aucun facteur d’échelle et
n’est pas encore intégrée à la branche principale.

Le test isolé du contrat de profils passe également (`5/5`) : priorité à
`resource_id`, repli sur chemin local normalisé, rejet d’un profil candidat et
erreur explicite en l’absence de profil validé.

Le rendu exporté permet toutefois de confirmer que le moteur applique bien une
échelle linéaire par taille — notamment 10→20 et 20→40 — et la même géométrie
relative entre portrait et paysage. Il ne permet pas de démontrer une formule
`xAdvance → largeur de layout` à `≤ 2 px`, ni de valider le wrapping mot par
mot. Le verdict reste
donc : **preuve de rendu réussie, calibration numérique de production non
figée**.

## Mesure requise avant validation

Pour fermer la calibration, il faut encore obtenir soit une largeur native
numérique de CapCut, soit une sonde qui rende une largeur connue sans clipping
et dont la relation avec l’avance soit explicitement définie. La comparaison
devra utiliser la même notion de largeur des deux côtés : encre raster contre
enveloppe d’encre, ou avance OpenType contre largeur de layout native. Le compte
rendu devra consigner :

- la version de CapCut et du CLI/moteur utilisé ;
- l’identifiant du draft témoin, le canvas et la police exacte ;
- les tailles CapCut testées et les largeurs observées/calculées ;
- la formule retenue, sa constante mesurée et sa tolérance d’erreur ;
- le verdict visuel sur le wrapping, le centrage et les offsets mot-par-mot.

Tant que ces champs ne sont pas remplis, la validation finale de
`cascade-words` reste bloquée. Les tests automatisés peuvent valider le
shaping OpenType et les invariants de layout, mais ne remplacent pas cette
vérification moteur. Le code de production reste inchangé dans la branche
principale ; le correctif kerning est uniquement présent comme adaptation
provisoire dans les worktrees de sonde et d’intégration.
