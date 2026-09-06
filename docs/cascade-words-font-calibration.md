# `cascade-words` — calibration CapCut des métriques de police

**Statut : SONDE KERNING VALIDÉE — adaptation expérimentale testée, calibration
globale CapCut encore non figée au 2026-09-03.**

Ce document est le verrou de traçabilité du plan, pas une autorisation de
modifier la production. La mini-sonde Rubik a été exportée depuis CapCut puis
analysée localement avec `ffmpeg`. Elle valide le comportement du kerning, mais
la constante complète `fontkit → largeur de layout CapCut` reste à confirmer
sur l’ensemble des chaînes et des polices.

## Mini-sonde Rubik — paires de kerning

Les quatre captions sont à la suite, à taille 20, centrées sur fond noir :
`AV`, `VA`, `AT`, puis `AA` comme contrôle sans paire kernée. Les exports
analysés sont :

- `C:/Users/dbele/AppData/Local/CapCut/Videos/cascade-words-font-kerning-probe-portrait-202.mp4` (`1080×1920`) ;
- `C:/Users/dbele/AppData/Local/CapCut/Videos/cascade-words-font-kerning-probe-landscape-20.mp4` (`1920×1080`).

Les deux flux sont H.264, 30 fps, d’une durée de `7,866667 s`. Les frames ont
été extraites explicitement aux timestamps `1, 3, 5, 7 s` avec :

`C:/Users/dbele/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe`

Références fontkit Rubik-Bold à taille 20, en pixels CapCut avant facteur :

| Texte | `layout().xAdvance` kerné | Avance non kernée | Bbox vectorielle | Portrait exporté | Paysage ramené à 1080 |
|---|---:|---:|---:|---:|---:|
| `AV` | 27,240 | 28,280 | 26,580 | 147 px | 146,2 px |
| `VA` | 27,240 | 28,280 | 26,580 | 147 px | 146,2 px |
| `AT` | 25,580 | 26,980 | 24,960 | 141 px | 139,5 px |
| `AA` | 28,720 | 28,720 | 28,280 | 150 px | 149,6 px |

`AV` et `VA` ont chacun une réduction de kerning fontkit de `1,040 px`, et
`AT` de `1,400 px`. Le rendu CapCut suit l’avance non kernée : les rapports
portrait entre rendu et avance non kernée sont environ `5,197`, `5,197`,
`5,226` et `5,226`, alors que l’avance kernée sous-estimerait nettement les
deux premières paires. Le contrôle `AA`, sans kerning, confirme l’échelle.

**Conclusion de la mini-sonde :** pour Rubik-Bold dans ce style, CapCut semble
ignorer le kerning. La mesure compatible est donc l’avance des glyphes sans
réduction de kerning, avec un facteur local proche de `5,22`. Cette conclusion
est confirmée par les paires contrôlées ; elle ne constitue pas encore une
constante de production globale.

## Captures CapCut déjà transmises

Les captures de l’éditeur avec règle et repères sont suffisantes pour confirmer
que le cadre de sélection est centré et que le passage de la taille 20 à 40
est approximativement linéaire pour Rubik et Pricedown. Elles ne fournissent
toutefois pas de lecture numérique directe des deux bords du cadre : les
graduations sont visuelles, le zoom de l’interface varie entre captures et le
cadre n’expose pas de champ de largeur natif. Elles ne peuvent donc pas fixer
un facteur absolu plus fiable que les largeurs extraites des exports MP4. Aucune
nouvelle capture n’est requise à ce stade.

## Lien avec la sonde complète

La sonde complète 12 captions a déjà montré qu’un ajustement Rubik non kerné
réduit l’erreur maximale sur les largeurs d’encre de `33,91 px` à `2,76 px`.
La mini-sonde confirme la cause de l’écart `AVATAR`, mais la tolérance stricte
de `≤ 2 px` n’est pas encore démontrée sur toutes les chaînes : une bbox
d’encre rasterisée ne mesure pas directement `xAdvance`, et Pricedown présente
sa propre échelle.

Les résultats de cette mini-sonde sont maintenant reportés dans ce rapport et
ont servi à tester l’adaptation minimale du module de métriques ci-dessous.

## Adaptation expérimentale dans le worktree de sonde

Le module `src/utils/font-metrics.ts` additionne désormais les
`glyph.advanceWidth` des glyphes produits par `font.layout()`, au lieu des
`position.xAdvance` qui incluent le kerning OpenType. Le shaping reste donc
actif : les substitutions comme la ligature `fi` sont conservées, mais les
réductions de paires `AV`, `VA` et `AT` ne sont plus appliquées. La déclaration
locale Fontkit a été complétée pour typer `GlyphRun.glyphs`.

Le test `test/font-metrics.test.mjs` verrouille ce contrat sur `AV` avec le
fixture Rubik-Bold et vérifie séparément que `fi` continue à être façonné. Le
test échouait avec `xAdvance` (`24,84` contre `25,76` attendu), puis passe avec
l’avance glyphes. Vérifications du worktree : build et typecheck OK, tests
consommateurs `cascade-words`/résolution/preset `59/59`, suite complète `671/671`.
Le lint global reste en échec sur `41` fichiers pour le formatage de fins de
ligne/configuration préexistant ; aucun reformatage global n’a été appliqué.

Cette adaptation ne fixe pas encore le facteur d’échelle CapCut : la sonde
Rubik donne environ `5,22`, tandis que Pricedown donne environ `6,21`. Aucun
facteur arbitraire ni heuristique par nom de police n’est donc ajouté. Le
changement est limité à la branche/worktree
`codex/cascade-words-kerning-probe` et n’est pas encore reporté dans la branche
principale ni dans le worktree d’intégration.

## Mesure requise avant validation globale

La validation globale doit encore choisir explicitement entre largeur d’encre
et avance de layout, puis confirmer la formule sur des chaînes représentatives
et les deux familles. Le compte rendu devra consigner :

- la version de CapCut et du CLI/moteur utilisé ;
- l’identifiant du draft témoin, le canvas et la police exacte ;
- les tailles CapCut testées et les largeurs observées/calculées ;
- la formule retenue, sa constante mesurée et sa tolérance d’erreur ;
- le verdict visuel sur le wrapping, le centrage et les offsets mot-par-mot.

Tant que ces champs ne sont pas remplis, la validation finale de
`cascade-words` reste bloquée. Le code de production n’est modifié que dans le
worktree expérimental de sonde ; aucune intégration n’est décidée.
