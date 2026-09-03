# `cascade-words` — calibration CapCut des métriques de police

**Statut : BLOQUÉ — aucune calibration CapCut réelle validée au 2026-08-30.**

Ce document est le verrou de traçabilité du plan, pas un résultat de mesure. Le
runtime CapCut/cutcli nécessaire pour produire le draft témoin et vérifier le
rendu n’est pas disponible dans l’environnement de développement actuel. Aucune
constante empirique de conversion ne doit donc être ajoutée au code ou présentée
comme validée.

## Mesure requise avant validation

La sonde doit comparer, sur un rendu CapCut réel, les largeurs de texte pour une
police et plusieurs tailles connues avec la largeur calculée par `fontkit` via
`font.layout()` et les positions `xAdvance`. Le compte rendu devra consigner :

- la version de CapCut et du CLI/moteur utilisé ;
- l’identifiant du draft témoin, le canvas et la police exacte ;
- les tailles CapCut testées et les largeurs observées/calculées ;
- la formule retenue, sa constante mesurée et sa tolérance d’erreur ;
- le verdict visuel sur le wrapping, le centrage et les offsets mot-par-mot.

Tant que ces champs ne sont pas remplis et que le rendu n’est pas positif, la
validation finale de `cascade-words` reste bloquée. Les tests automatisés
peuvent valider le shaping OpenType et les invariants de layout, mais ne
remplacent pas cette vérification moteur.
