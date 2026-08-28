# `cascade-words` v3 — Plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Les étapes utilisent `- [ ]` pour le suivi.

**Goal:** Remplacer le comptage de caractères de `cascade-words` par une mise en page basée sur la largeur réellement mesurée de la police rendue par CapCut, pour corriger à la fois le wrapping et le positionnement horizontal des mots.

**Architecture:** Un module profond de métriques masque le parsing et le cache des polices derrière une petite interface de largeur. Un planificateur pur reçoit cette interface et calcule lignes, bornes et positions X avant toute mutation du draft. La police effectivement mesurée est aussi injectée dans les matériaux texte générés afin que la police mesurée et la police rendue soient toujours identiques.

**Tech Stack:** Node.js `>=18`, TypeScript, `fontkit` comme dépendance de production, `node:test`, Biome, drafts JSON CapCut.

**Spec:** `docs/plan-2026-08-28-cascade-words-font-metrics.md` — ce document contient les exigences, les décisions verrouillées et le plan d’implémentation.

## Contraintes globales

- La police est obligatoire : aucune exécution ne retombe silencieusement sur `CHAR_WIDTH_FACTOR` ou sur un comptage de caractères.
- `--font <name|resource_id>` doit modifier la police écrite dans les matériaux texte, pas seulement la police utilisée pour les calculs.
- `--clone-style` conserve le style du guide ; si `--font` est également fourni, `--font` remplace uniquement l’identité de police et le reste du style cloné est conservé.
- La taille effective est `--font-size` explicite, puis la taille du style cloné, puis `material.font_size`, puis `15`.
- La mesure utilise le layout OpenType (`font.layout()` et ses positions `xAdvance`), pas une simple somme de glyphes indépendants. La documentation officielle de fontkit expose explicitement cette API et son support du kerning et des substitutions avancées : https://github.com/foliojs/fontkit#glyph-metrics-and-layout.
- La calibration `font_size` CapCut → pixels doit être déterminée sur un rendu CapCut réel avant d’être codée. Aucun chiffre empirique ne doit être ajouté avant cette étape.
- Le wrapping MVP utilise la largeur complète du canvas (`draft.canvas_config.width`) et conserve chaque mot trop long sur sa propre ligne ; aucune marge de sécurité implicite n’est ajoutée.
- `--max-chars` est supprimé : `cascade-words` est encore sur une branche locale non publiée, et la police devient la source unique de mesure. Le parser doit refuser explicitement l’ancien flag au lieu de l’ignorer.
- Toute erreur de police ou de mise en page survient avant la première mutation du draft.
- `package.json` et `package-lock.json` restent synchronisés ; l’ajout de `fontkit` est la première dépendance de production du CLI.
- Les tests ne dépendent pas d’une police installée dans le dossier CapCut de la machine de développement.

## État actuel vérifié

La branche `feat/cascade-words` est au commit local `44c6915`, non publié. [`cascade-words.ts`](../src/commands/cascade-words.ts) contient encore `CHAR_WIDTH_FACTOR`, `groupLines(..., maxChars)` et une option `maxChars` facultative. Les tests existants vérifient surtout le signe de `transform.x` et appellent `cascadeWords()` sans police.

[`buildTextMaterial()`](../src/commands/create.ts) crée actuellement le bloc `content` sans identité de police en mode par défaut. Le schéma CapCut documente deux endroits à maintenir : `content.styles[*].font` et les miroirs externes `font_path`, `font_id`, `font_title`, `fonts` dans le matériau texte.

[`resolveCloneStyle()`](../src/commands/create.ts) extrait déjà le premier style du guide. Il peut fournir le chemin de police et la taille réelle à condition que le plan les lise comme style effectif, au lieu d’utiliser aveuglément la valeur `fontSize` de l’appelant.

[`planMakePreset()`](../src/commands/make-preset.ts) contient la logique de matching nom/resource ID, mais la commande actuelle scanne uniquement les drafts. Le nouveau résolveur doit partager cette logique et consulter d’abord le catalogue persistant, puis les drafts, afin qu’une police reste résoluble après suppression de son draft témoin.

## Contrats de modules

Le seam principal est le module de métriques : `cascade-words` ne connaît pas l’objet interne fontkit. Le planificateur de mise en page reçoit une fonction de largeur injectée, ce qui permet de tester le wrapping et les positions avec un faux mesurateur sans parser de police.

```ts
export interface FontMeasureStyle {
  fontPath: string;
  capcutFontSize: number;
  letterSpacing: number;
}

export interface FontMetrics {
  measure(text: string, style: FontMeasureStyle): number;
}

export function measureTextWidthPx(
  fontPath: string,
  text: string,
  capcutFontSize: number,
  letterSpacing?: number,
): number;
```

Le module cache les polices parsées par chemin canonique. Il convertit les unités internes de la police vers les pixels CapCut avec la constante de calibration documentée dans `docs/cascade-words-font-calibration.md`.

Le planificateur interne utilise le seam suivant :

```ts
type WidthOf = (text: string) => number;

interface CascadeLayout {
  lineOf: number[];
  lineTexts: string[];
  charRanges: Array<[number, number]>;
  lineWidthsPx: number[];
  wordX: number[];
}

function planCascadeLayout(
  cards: CaptionCard[],
  canvasWidth: number,
  widthOf: WidthOf,
): CascadeLayout;
```

`planCascadeLayout()` est pur : il ne crée ni track, ni material, ni fichier. Il groupe gloutonnement les mots avec un espace ASCII entre eux ; il calcule ensuite `wordX` à partir des largeurs des préfixes réels de la ligne.

## Tâches d’implémentation

### Task 1: Mesurer le rendu CapCut avant de fixer la formule

**Files:**
- Create: `docs/cascade-words-font-calibration.md`
- Read: `Shared/ENGINE-FACTS.md`, `docs/draft-schema/02-materials.md`
- Test artifact: un draft CapCut de sonde local, non versionné avec les médias

**Interfaces:**
- Consumes: `capcut-david init`, `init-meta --register`, `add-text`, le draft de démonstration de `cascade-words` et une vraie police avec un chemin connu.
- Produces: une formule et une constante mesurées, avec date, version CapCut, dimensions du canvas, police, taille et tolérance d’erreur consignées dans `docs/cascade-words-font-calibration.md`.

- [ ] **Step 1: Construire une sonde avec une chaîne connue.**

  Utiliser au minimum `AVATAR`, `this is the second` et `fi office`, à une taille CapCut connue, sur des canvas `1080×1920` et `1920×1080`. Appliquer dans CapCut la même police que le fichier résolu et sauvegarder le draft.

- [ ] **Step 2: Vérifier les champs natifs de largeur.**

  Inspecter `materials.texts[]`, le segment et le track pour `fixed_width`, `fixed_height`, `line_max_width`, `text_size`, `bounding` et les champs de typesetting. Si aucun champ ne décrit la largeur rendue, écrire explicitement cette conclusion dans le rapport ; le calcul de largeur par police reste alors nécessaire pour le wrapping et les mots.

- [ ] **Step 3: Comparer la largeur calculée à la largeur rendue.**

  Pour chaque cas, comparer la largeur pixel mesurée dans CapCut à :

  ```text
  widthPx = layout(text).advanceWidth / unitsPerEm
             * capcutFontSize * CAPCUT_FONT_SCALE
             + letterSpacingContribution
  ```

  Mesurer au moins deux tailles et deux familles de police. Accepter la formule seulement si la même constante reste dans `<= 1 %` et `<= 2 px` d’erreur sur les cas retenus. Si l’échelle dépend du canvas ou du style, conserver cette dépendance dans le contrat au lieu de la masquer derrière une constante globale.

- [ ] **Step 4: Documenter la décision de calibration.**

  Écrire dans `docs/cascade-words-font-calibration.md` les valeurs mesurées, la formule finale, la tolérance, la version CapCut et le motif de rejet de toute formule concurrente. Ne pas écrire de valeur dans le code avant que ce fichier soit complet.

- [ ] **Step 5: Committer la sonde documentaire.**

  ```bash
  git add docs/cascade-words-font-calibration.md
  git commit -m "docs(cascade-words): record CapCut font calibration"
  ```

### Task 2: Extraire un résolveur de police réutilisable

**Files:**
- Create: `src/utils/font-resolver.ts`
- Modify: `src/commands/make-preset.ts`
- Modify: `src/commands/cascade-words.ts`
- Test: `test/font-resolver.test.mjs`

**Interfaces:**
- Consumes: entrées `fonts[]` des drafts, entrées `font` du catalogue, `resolveCataloguePath()`, `defaultProjectsRoot()` et un nom/resource ID fourni par l’utilisateur.
- Produces:

  ```ts
  export interface ResolvedFont {
    title: string;
    resourceId: string | null;
    fontPath: string;
    source: "catalogue" | "draft";
  }

  export function resolveFontReference(
    reference: string,
    options?: { draftsRoot?: string; cwd?: string },
  ): ResolvedFont;
  ```

- [ ] **Step 1: Déplacer le matching pur hors de `make-preset.ts`.**

  Conserver les règles existantes : resource ID numérique = correspondance exacte ; nom = sous-chaîne insensible à la casse ; doublons identiques dédupliqués ; ambiguïté refusée avec la liste des candidats. `make-preset` réutilise ensuite ce module sans changer son enveloppe JSON.

- [ ] **Step 2: Ajouter la recherche catalogue puis drafts.**

  Lire `Shared/capcut-catalogue.json` via `resolveCataloguePath()`. Pour une entrée font, sélectionner un `font_paths[]` existant et lisible. Si aucune entrée exploitable ne correspond, scanner le root de drafts comme le fait aujourd’hui `make-preset`. Une entrée trouvée mais dont tous les chemins ont disparu doit produire une erreur claire, pas un chemin mort.

- [ ] **Step 3: Valider la police avant de la retourner.**

  Vérifier `existsSync(fontPath)` et `statSync(fontPath).isFile()`. La validation syntaxique fontkit reste dans `font-metrics.ts`, mais l’erreur doit conserver le nom/resource ID demandé et le chemin fautif.

- [ ] **Step 4: Tester les sources et les ambiguïtés.**

  Couvrir : catalogue avec chemin existant, catalogue avec témoin supprimé mais fichier encore présent, fallback draft, resource ID exact, matching ambigu, chemin absent et entrée local-only. Vérifier qu’un échec n’écrit rien.

- [ ] **Step 5: Committer le seam de résolution.**

  ```bash
  git add src/utils/font-resolver.ts src/commands/make-preset.ts test/font-resolver.test.mjs
  git commit -m "refactor(fonts): share catalogue-backed font resolution"
  ```

### Task 3: Ajouter l’adaptateur fontkit et ses tests

**Files:**
- Create: `src/utils/font-metrics.ts`
- Create: `test-fixtures/fonts/Rubik-Bold.ttf`
- Create: `test-fixtures/fonts/OFL.txt`
- Create: `test/font-metrics.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `ResolvedFont.fontPath`, la formule de `docs/cascade-words-font-calibration.md` et `FontMeasureStyle`.
- Produces: `FontMetrics.measure()` et `measureTextWidthPx()` ; aucune classe fontkit n’est exportée aux commandes.

- [ ] **Step 1: Ajouter la dépendance de production.**

  Ajouter `fontkit` dans `dependencies`, exécuter l’installation avec le gestionnaire de paquets du dépôt et vérifier que `package-lock.json` contient la même dépendance racine. Vérifier l’import ESM et les types TypeScript contre la version réellement installée avant d’utiliser l’API.

- [ ] **Step 2: Écrire les tests du wrapper avant l’implémentation.**

  Les tests doivent vérifier : fichier TTF lisible, largeur positive, largeur nulle pour la chaîne vide, proportionnalité avec la taille, cache du même chemin, erreur lisible pour fichier absent et erreur lisible pour police illisible. Ajouter des cas `AV`, `fi`, espaces et accents.

- [ ] **Step 3: Implémenter le cache et le layout OpenType.**

  Utiliser `fontkit.openSync()` une fois par chemin canonique. Pour chaque texte, utiliser `font.layout(text)` et sommer les positions `xAdvance` du run, avec la conversion `unitsPerEm → pixels` issue de la calibration. Ne pas utiliser `glyphsForString()` comme moteur de mesure : cette méthode ne fait qu’une correspondance caractère-glyphe, alors que `layout()` applique le shaping.

- [ ] **Step 4: Ajouter la contribution de l’espacement.**

  Convertir `letterSpacing` selon la même convention CapCut que celle utilisée pendant la sonde. Si la conversion n’est pas validée, exiger `letterSpacing === 0` dans le style effectif et refuser tout style cloné qui violerait cette invariance ; aucune largeur fausse ne doit être produite silencieusement.

- [ ] **Step 5: Vérifier les invariants numériques.**

  Utiliser la police fixture sous licence OFL, conserver des attentes numériques indépendantes de la police installée localement et vérifier que la largeur d’une chaîne mise en page n’est pas obtenue par simple addition de mesures de mots lorsque le kerning ou une ligature modifie le résultat.

- [ ] **Step 6: Committer l’adaptateur.**

  ```bash
  git add src/utils/font-metrics.ts test/font-metrics.test.mjs test-fixtures/fonts package.json package-lock.json
  git commit -m "feat(metrics): add cached OpenType font measurement"
  ```

### Task 4: Normaliser le style effectif et l’écrire dans les matériaux

**Files:**
- Modify: `src/commands/create.ts`
- Modify: `src/commands/cascade-words.ts`
- Modify: `src/utils/cli.ts`
- Modify: `src/index.ts`
- Test: `test/create.test.mjs`
- Test: `test/cascade-words.test.mjs`

**Interfaces:**
- Consumes: `ResolvedFont`, `resolveCloneStyle()`, `flags.font`, `flags.fontSize` et la première carte du guide.
- Produces:

  ```ts
  interface EffectiveTextStyle {
    fontPath: string;
    fontId: string;
    fontTitle: string;
    fontSize: number;
    letterSpacing: number;
    clonedStyle?: Record<string, unknown>;
  }
  ```

- [ ] **Step 1: Définir la priorité de la police.**

  Appliquer exactement ces règles :

  1. `--font` explicite gagne toujours et remplace `styleBlock.font` dans le matériau final.
  2. Sans `--font`, `--clone-style` exige un `styleBlock.font.path` existant et lisible.
  3. Sans l’un de ces deux chemins, `cascade-words` appelle `die()` avant toute mutation.

- [ ] **Step 2: Définir la taille et les paramètres horizontaux.**

  Lire la taille dans l’ordre `flags.fontSize`, `styleBlock.size`, `material.font_size`, `15`. Reprendre `letter_spacing` du matériau cloné. Refuser les styles clonés à `letter_spacing` non nul tant que la conversion n’a pas été validée par Task 3. Le contenu courbé et les boîtes à largeur fixe ne font pas partie du MVP : refuser `text_curve`, `fixed_width > 0` ou `fixed_height > 0` avec un message expliquant que `cascade-words` exige un texte linéaire mesurable.

- [ ] **Step 3: Ajouter une identité de police partagée aux builders texte.**

  Étendre les builders existants avec un paramètre optionnel de police et une fonction commune qui maintient les deux représentations :

  ```ts
  interface TextFontIdentity {
    path: string;
    id: string;
    title?: string;
    resourceId?: string | null;
    sourcePlatform?: number;
    fontsEntry?: Record<string, unknown>;
  }

  function applyTextFontIdentity(
    material: Record<string, unknown>,
    identity: TextFontIdentity,
  ): void;
  ```

  La fonction met à jour `content.styles[*].font` et les miroirs externes `font_path`, `font_id`, `font_title`, `font_resource_id`, `font_source_platform`, `fonts`. En mode `--font` sans clone, le matériau généré doit donc rendre effectivement la police mesurée.

- [ ] **Step 4: Tester la cohérence de rendu.**

  Vérifier que chaque matériau produit possède le même chemin de police dans `content.styles[0].font.path` et `font_path`, le même ID lorsqu’il existe, et la même taille dans le style et le miroir externe. Ajouter un test `--font` sans `--clone-style`, un test clone seul et un test des deux options ensemble.

- [ ] **Step 5: Committer le contrat de style.**

  ```bash
  git add src/commands/create.ts src/commands/cascade-words.ts src/utils/cli.ts src/index.ts test/create.test.mjs test/cascade-words.test.mjs
  git commit -m "feat(cascade-words): bind measured font to generated text"
  ```

### Task 5: Remplacer le wrapping et le calcul X par un layout pur

**Files:**
- Modify: `src/commands/cascade-words.ts`
- Test: `test/cascade-words.test.mjs`

**Interfaces:**
- Consumes: `EffectiveTextStyle`, `FontMetrics.measure`, `CaptionCard[]` et `draft.canvas_config.width`.
- Produces: `CascadeLayout` complet avant l’ajout du premier track.

- [ ] **Step 1: Écrire les tests de wrapping avec un mesurateur injecté.**

  Utiliser un faux `widthOf` qui retourne des largeurs distinctes pour `i`, `W`, les espaces et les mots. Vérifier que deux phrases de même longueur en caractères peuvent produire des coupures différentes, que la frontière exacte tient sur la ligne, qu’un mot trop long reste seul et que l’espace inter-mot est mesuré.

- [ ] **Step 2: Implémenter le wrapping glouton par largeur.**

  Pour chaque carte, former `candidate = currentLine === "" ? word : currentLine + " " + word`. Commencer une nouvelle ligne lorsque `widthOf(candidate) > canvasWidth` et que la ligne courante n’est pas vide. Conserver l’ordre des cartes et retourner `lineOf`, `lineTexts` et `charRanges`.

- [ ] **Step 3: Implémenter les positions par préfixe.**

  Pour une carte donnée, avec `[charStart, charEnd)` dans sa ligne :

  ```ts
  const pxStart = widthOf(lineText.slice(0, charStart));
  const pxEnd = widthOf(lineText.slice(0, charEnd));
  const wordMidPx = (pxStart + pxEnd) / 2;
  const lineMidPx = widthOf(lineText) / 2;
  const x = (wordMidPx - lineMidPx) / (canvasWidth / 2);
  ```

  Utiliser les préfixes complets afin de conserver le kerning et le shaping déjà appliqués au contexte de la ligne. Ne pas revenir à `deltaChars * CHAR_WIDTH_FACTOR`.

- [ ] **Step 4: Pré-calculer tout avant de muter le draft.**

  Résoudre la police, parser la police, valider les cartes, calculer le layout et préparer les matériaux dans une phase sans effet de bord. Ensuite seulement pousser les tracks et matériaux existants. Un échec de parsing, de mesure ou de style doit laisser le draft identique octet pour octet en mémoire.

- [ ] **Step 5: Supprimer l’ancien chemin.**

  Retirer `CHAR_WIDTH_FACTOR`, `groupLines(..., maxChars)`, `maxChars` de `CascadeWordsOptions` et `Flags`, le parsing normal de `--max-chars` et toute documentation qui décrit le comptage de caractères. Ajouter à `parseFlags()` un rejet explicite : `--max-chars was removed; cascade-words now wraps from the resolved font metrics.`

- [ ] **Step 6: Vérifier les propriétés métier conservées.**

  Garder les invariants déjà validés : guide caché par `track.attribute & 2`, `segment.visible` inchangé, marqueur `cascade_words_consumed`, bornes de ligne et timing du dernier mot, collisions de préfixes, sortie des IDs dans l’ordre des pistes.

- [ ] **Step 7: Committer le layout.**

  ```bash
  git add src/commands/cascade-words.ts src/utils/cli.ts src/index.ts test/cascade-words.test.mjs
  git commit -m "feat(cascade-words): lay out words with font metrics"
  ```

### Task 6: Compléter la couverture CLI et la documentation moteur

**Files:**
- Modify: `src/index.ts`
- Modify: `src/capabilities.ts`
- Modify: `test/capabilities.test.mjs`
- Modify: `test/cascade-words.test.mjs`
- Modify: `CHANGELOG.md`
- Create: `release-notes/2.8.0.md`

**Interfaces:**
- Consumes: le contrat final des Tasks 2–5.
- Produces: une aide CLI et une carte de capacité qui décrivent `--font` comme requis sauf clone-style exploitable, et le wrapping comme mesuré en pixels.

- [ ] **Step 1: Mettre à jour l’aide et la capacité.**

  Documenter `--font <name|resource_id>`, la priorité `--font`/`--clone-style`, l’échec sans police et la suppression de `--max-chars`. Modifier le résumé, la signature, les flags et l’exemple de `cascade-words` dans `src/capabilities.ts`.

- [ ] **Step 2: Tester le texte d’aide et la carte.**

  Vérifier que `--help`, la capacité sérialisée et la page UI générée ne contiennent plus `--max-chars` et contiennent la nouvelle exigence de police. Vérifier également que l’entrée reste marquée `capcutClosed: true` et `readOnly: false`.

- [ ] **Step 3: Écrire la note de release.**

  Indiquer la rupture locale `--max-chars`, l’ajout de la première dépendance de production, la résolution catalogue/draft, le besoin d’un chemin de police lisible et la validation CapCut manuelle. Ajouter le lien vers `docs/cascade-words-font-calibration.md`.

- [ ] **Step 4: Committer la documentation.**

  ```bash
  git add src/index.ts src/capabilities.ts test/capabilities.test.mjs test/cascade-words.test.mjs CHANGELOG.md release-notes/2.8.0.md
  git commit -m "docs(cascade-words): document measured-font contract"
  ```

### Task 7: Exécuter les gates et la validation CapCut réelle

**Files:**
- Read: tous les fichiers modifiés par les Tasks 1–6
- Verify: draft de démonstration `cascade-words-demo-v7` ou son équivalent courant

**Interfaces:**
- Consumes: le CLI construit, la fixture de police, le rapport de calibration et un draft avec guide importé.
- Produces: un résultat de gates complet et une validation visuelle documentée avant merge.

- [ ] **Step 1: Exécuter les gates automatisées.**

  ```bash
  npm run typecheck
  npm run build
  npm run lint
  npm test
  ```

  Les quatre commandes doivent sortir avec le code `0`. Le build doit régénérer la carte des capacités sans diff inattendu.

- [ ] **Step 2: Construire le draft de vérification.**

  Utiliser l’ordre moteur validé : `init` → `init-meta --register` → guide texte → `cascade-words` avec la police résolue → `validate` → ouverture dans CapCut. Garder CapCut fermé pendant les mutations et sauvegarder le draft après toute vérification effectuée dans l’UI.

- [ ] **Step 3: Vérifier le rendu visuel.**

  Tester une phrase avec largeurs très différentes (`i` contre `W`), accents, ponctuation, au moins deux lignes et une transition entre lignes. Vérifier que chaque mot s’aligne sur sa position dans la ligne, que le guide reste masqué par l’œil de piste et que le dernier mot disparaît à la borne attendue.

- [ ] **Step 4: Vérifier les alignements supportés.**

  Tester `--align 0`, `--align 1` et `--align 2`. Si le repère CapCut n’est pas le même pour les trois modes, restreindre explicitement le MVP à l’alignement centré et faire échouer les deux autres avec un message, plutôt que de publier des positions approximatives.

- [ ] **Step 5: Vérifier la duplicabilité du draft.**

  Dupliquer ou renommer le draft, rouvrir les deux copies dans CapCut et confirmer que la police et les matériaux texte restent résolus depuis les chemins écrits. Cette vérification complète le contrat de chemins déjà appliqué aux médias.

- [ ] **Step 6: Capturer le résultat de validation.**

  Ajouter au rapport de calibration la date, le nom du draft, la version moteur, la version CapCut, les commandes exécutées et le verdict visuel. Le merge est autorisé uniquement si les gates automatisées et cette vérification manuelle sont positives.

## Matrice de couverture finale

| Risque | Test automatisé | Test réel requis |
|---|---|---|
| Police absente/illisible | `font-resolver`, `font-metrics` | Non |
| Police mesurée différente de la police rendue | matériaux `content` + miroirs externes | Oui |
| Kerning/ligatures | fixture et layout OpenType | Oui pour le rendu |
| Mauvais facteur CapCut | tests de formule | Oui |
| Wrapping dépendant des caractères | faux `widthOf` + fixture réelle | Oui sur phrase longue |
| Style cloné avec taille différente | tests de style effectif | Oui |
| `letter_spacing` ou boîte fixe incompatible | tests d’erreur explicite | Oui si le style de production les utilise |
| Erreur après préparation partielle | snapshot sans mutation | Non |
| Guide visible ou timing régressé | tests cascade existants migrés | Oui |
| API `--max-chars` silencieusement ignorée | test parser d’erreur | Non |

## Critère de merge

Le chantier est prêt à merger lorsque :

1. la formule de calibration est écrite et validée sur un rendu CapCut réel ;
2. `--font` et `--clone-style` produisent la même police que celle mesurée ;
3. `font.layout()` est utilisé derrière le module de métriques caché ;
4. le wrapping et `transform.x` sont calculés par le layout pur injecté ;
5. aucune erreur de police ne mute partiellement le draft ;
6. `npm run typecheck && npm run build && npm run lint && npm test` passe ;
7. le draft de démonstration est visuellement correct dans CapCut.
