/**
 * Registre typé des capacités du CLI — une carte par verbe dispatché dans src/index.ts.
 * Source de vérité pour la future page UI (T2) — le verbe `ui` lui-même (T3) ne lit
 * PAS ce registre au runtime, il l'embarque à la build.
 *
 * Règle anti-dérive : test/capabilities.test.mjs compare CAPABILITIES aux verbes
 * réellement dispatchés (`cmd === "x"` / `case "x":`) dans src/index.ts — toute
 * carte fantôme ou tout verbe non documenté fait échouer le test.
 */

export type CapabilityCategory = "creer" | "peupler" | "captions" | "editer" | "animer" | "reparer" | "decouvrir";

export interface CapabilityFlag {
  flag: string;
  desc: string;
  since?: string;
}

export interface Capability {
  verb: string;
  category: CapabilityCategory;
  summary: string;
  signature: string;
  flags: CapabilityFlag[];
  example: string;
  readOnly: boolean;
  capcutClosed: boolean;
  since: string;
}

export interface Chain {
  name: string;
  steps: { verb: string; note: string }[];
}

export const CATEGORY_LABELS: Record<CapabilityCategory, string> = {
  creer: "Créer",
  peupler: "Peupler",
  captions: "Captions & Styles",
  editer: "Éditer",
  animer: "Animer",
  reparer: "Réparer & Valider",
  decouvrir: "Découvrir",
};

export const CAPABILITIES: Capability[] = [
  // ---- creer ----------------------------------------------------------
  {
    verb: "init",
    category: "creer",
    summary:
      "Crée un draft vierge depuis le template minimal (canvas 1080×1920 possible via --width/--height). N'écrit PAS draft_meta_info.json et n'indexe pas : toujours chaîner init-meta --register.",
    signature: "init <name> [--template <dir>] [--drafts <dir>] [--width <n> --height <n>]",
    flags: [
      { flag: "--width <n> --height <n>", desc: "dimensions du canvas (ensemble obligatoire)", since: "2.1.0" },
      { flag: "--template <dir>", desc: "template source (défaut : minimal embarqué)" },
      { flag: "--drafts <dir>", desc: "root de destination (défaut : root CapCut plateforme)" },
    ],
    example: "capcut-david init mon-draft --width 1080 --height 1920",
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "init-meta",
    category: "creer",
    summary:
      "Génère le sidecar draft_meta_info.json MANQUANT à côté de draft_content.json (répare le meta.missing de validate). Refuse si le sidecar existe déjà (--force pour écraser, .bak d'abord). --register chaîne register.",
    signature: "init-meta <project> [--force] [--register] [--projects-root <dir>] [--dry-run]",
    flags: [
      { flag: "--force", desc: "écrase un sidecar déjà existant (écrit un .bak avant)" },
      { flag: "--register", desc: "chaîne register après la génération du sidecar" },
      { flag: "--projects-root <dir>", desc: "root CapCut (forwardé à register)" },
      { flag: "--dry-run", desc: "prévisualise sans écrire" },
    ],
    example: 'capcut-david init-meta "<draft-dir>" --register',
    readOnly: false,
    capcutClosed: true,
    since: "1.11.0",
  },
  {
    verb: "register",
    category: "creer",
    summary:
      "Ajoute un draft déjà construit au root_meta_info.json de CapCut pour qu'il apparaisse dans l'UI. Idempotent (clé = draft_fold_path).",
    signature: "register <draft-dir> [--projects-root <dir>]",
    flags: [{ flag: "--projects-root <dir>", desc: "override du root CapCut (défaut : root plateforme)" }],
    example: 'capcut-david register "<draft-dir>"',
    readOnly: false,
    capcutClosed: true,
    since: "1.1.0",
  },
  {
    verb: "psycho-build",
    category: "creer",
    summary:
      "Construit un draft TikTok complet (1080×1920) en un seul appel depuis un manifest YAML : images + Ken Burns + narration + musique + captions SRT. --register indexe le draft dans l'UI CapCut.",
    signature: "psycho-build <manifest.yaml> [--out <dir>] [--seed <n>] [--register] [--projects-root <dir>]",
    flags: [
      { flag: "--out <dir>", desc: "dossier de sortie du draft" },
      { flag: "--seed <n>", desc: "graine déterministe (mêmes UUID à manifest identique)" },
      { flag: "--register", desc: "indexe aussi le draft dans root_meta_info.json" },
      { flag: "--projects-root <dir>", desc: "root CapCut (forwardé à register)" },
    ],
    example: "capcut-david psycho-build manifest.yaml --out ./out --register",
    readOnly: false,
    capcutClosed: true,
    since: "0.4.0",
  },
  {
    verb: "save-template",
    category: "creer",
    summary: "Sauvegarde un segment existant comme template réutilisable (fichier JSON) pour apply-template.",
    signature: "save-template <project> <id> <name> --out <path>",
    flags: [{ flag: "--out <path>", desc: "chemin du fichier template écrit" }],
    example: 'capcut-david save-template "<draft-dir>" <segment-id> mon-template --out ./mon-template.json',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "apply-template",
    category: "creer",
    summary: "Applique un template sauvegardé (save-template) comme nouveau segment, avec position/texte optionnels.",
    signature: "apply-template <project> <template.json> <start> <duration> [text override] [--x <n>] [--y <n>]",
    flags: [
      { flag: "--x <n>", desc: "position horizontale du clip" },
      { flag: "--y <n>", desc: "position verticale du clip" },
    ],
    example: 'capcut-david apply-template "<draft-dir>" ./mon-template.json 0s 3s',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },

  // ---- peupler ----------------------------------------------------------
  {
    verb: "add-video",
    category: "peupler",
    summary:
      "Ajoute un segment vidéo : le média est copié dans <draft>/Resources/ et référencé par un token draftpath portable (survit au renommage/duplication CapCut). --batch ajoute plusieurs plans en un seul save.",
    signature:
      "add-video <project> <file> <start> <duration> [--track-name <s>] | add-video <project> --batch @items.json",
    flags: [
      { flag: "--track-name <s>", desc: "piste vidéo cible (défaut : première piste vidéo)" },
      {
        flag: "--batch @items.json",
        desc: "[{path,start,duration,width?,height?,volume?,trackName?}] — tout-ou-rien, un seul save, since 2.1.0",
        since: "2.1.0",
      },
    ],
    example: 'capcut-david add-video "<draft-dir>" clip.mp4 0s 3s',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "add-audio",
    category: "peupler",
    summary:
      "Ajoute un segment audio (narration/musique/SFX) avec volume optionnel. --batch ajoute plusieurs pistes/segments en un seul save.",
    signature:
      "add-audio <project> <file> <start> <duration> [--volume <n>] [--track-name <s>] | add-audio <project> --batch @items.json",
    flags: [
      { flag: "--volume <n>", desc: "niveau de volume (0.0-1.0)" },
      { flag: "--track-name <s>", desc: "piste audio cible" },
      {
        flag: "--batch @items.json",
        desc: "[{path,start,duration,volume?,trackName?}] — tout-ou-rien, un seul save, since 2.1.0",
        since: "2.1.0",
      },
    ],
    example: 'capcut-david add-audio "<draft-dir>" narration.mp3 0s 12s',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "add-text",
    category: "peupler",
    summary:
      "Ajoute une caption/texte, avec surlignage d'un mot-clé (couleur + taille) et positionnement libre. Support du multi-span rich-text natif CapCut.",
    signature:
      "add-text <project> <start> <duration> <text> [--font-size <n>] [--color <hex>] [--align <0|1|2>] [--x <n>] [--y <n>] [--track-name <s>] [--keyword <word> | --keyword-range <s,e>] [--keyword-color <hex>] [--keyword-size <n>]",
    flags: [
      { flag: "--font-size <n>", desc: "taille de police de base" },
      { flag: "--color <hex>", desc: "couleur de base du texte" },
      { flag: "--align <0|1|2>", desc: "alignement horizontal" },
      { flag: "--x <n> / --y <n>", desc: "position du clip" },
      { flag: "--keyword <word> | --keyword-range <s,e>", desc: "mot/plage à surligner", since: "1.4.0" },
      { flag: "--keyword-color <hex>", desc: "couleur du surlignage (défaut #FFD600)", since: "1.4.0" },
      { flag: "--keyword-size <n>", desc: "taille de police du mot surligné (points)", since: "1.15.0" },
    ],
    example: 'capcut-david add-text "<draft-dir>" 0s 3s "Regarde ça" --keyword ça --keyword-color "#FFD600"',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "import-captions",
    category: "peupler",
    summary:
      "Injecte un lot de captions mot-par-mot depuis un JSON (remplace toute la piste texte). Surlignage par carte, clonage de style CapCut existant, et positionnement vertical natif.",
    signature:
      "import-captions <project> <captions.json> [--color <hex>] [--color-cycle <hex,hex,...>] [--highlight-color <hex>] [--highlight-size <n>] [--transform-y <n>] [--track-name <s>] [--clone-style]",
    flags: [
      { flag: "--color <hex>", desc: "couleur de base des captions" },
      {
        flag: "--color-cycle <hex,hex,...>",
        desc: "couleur de base par carte, carte i = cycle[i % n] (remplace --color)",
        since: "2.3.0",
      },
      { flag: "--highlight-color <hex>", desc: "couleur de surlignage par défaut" },
      {
        flag: "--highlight-size <n>",
        desc: "taille par défaut des mots surlignés (hlSize par carte gagne)",
        since: "1.15.0",
      },
      {
        flag: "--transform-y <n>",
        desc: "position verticale native de chaque caption reconstruite (ex. -0.4 = mi-bas)",
        since: "1.16.0",
      },
      {
        flag: "--clone-style",
        desc: "conserve le style existant de la piste cible (police/contour/ombre)",
        since: "1.5.0",
      },
    ],
    example: 'capcut-david import-captions "<draft-dir>" captions.json --transform-y -0.4 --clone-style',
    readOnly: false,
    capcutClosed: true,
    since: "1.4.0",
  },

  // ---- captions ----------------------------------------------------------
  {
    verb: "restyle",
    category: "captions",
    summary:
      "Applique un preset de style (police/contour/ombre/taille) à toutes les captions d'une ou toutes les pistes texte. Span-aware : les couleurs de mots-clés survivent au changement de police.",
    signature: "restyle <project> --preset <preset.json> [--track-name <s>]",
    flags: [{ flag: "--track-name <s>", desc: "piste texte ciblée (défaut : toutes)" }],
    example: 'capcut-david restyle "<draft-dir>" --preset CC-DerStil.json',
    readOnly: false,
    capcutClosed: true,
    since: "1.6.0",
  },
  {
    verb: "make-preset",
    category: "captions",
    summary:
      "Génère un preset de police NUE (identité seule) pour restyle --preset, à partir d'une police déjà utilisée dans la bibliothèque de drafts (le cousin générateur de query). Lecture seule.",
    signature: "make-preset --font <name|resource_id> [--out <file>] [--drafts <dir>]",
    flags: [
      { flag: "--out <file>", desc: "écrit le preset généré dans un fichier" },
      { flag: "--drafts <dir>", desc: "root de la bibliothèque de drafts à scanner" },
    ],
    example: 'capcut-david make-preset --font "Poppins" --out preset.json',
    readOnly: true,
    capcutClosed: false,
    since: "1.14.0",
  },
  {
    verb: "set-text",
    category: "captions",
    summary:
      "Modifie le contenu texte d'une caption existante. Refuse sur une caption multi-span (surlignage mot-clé) pour ne pas la corrompre.",
    signature: "set-text <project> <id> <text>",
    flags: [],
    example: 'capcut-david set-text "<draft-dir>" <segment-id> "Nouveau texte"',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "texts",
    category: "captions",
    summary: "Liste tout le contenu texte/sous-titres du draft.",
    signature: "texts <project>",
    flags: [],
    example: 'capcut-david texts "<draft-dir>"',
    readOnly: true,
    capcutClosed: false,
    since: "0.1.0",
  },
  {
    verb: "export-srt",
    category: "captions",
    summary: "Exporte les sous-titres du draft au format SRT.",
    signature: "export-srt <project>",
    flags: [],
    example: 'capcut-david export-srt "<draft-dir>"',
    readOnly: true,
    capcutClosed: false,
    since: "0.1.0",
  },

  // ---- editer ----------------------------------------------------------
  {
    verb: "shift",
    category: "editer",
    summary: "Décale la temporalité d'un segment (ex. +0.5s, -1s).",
    signature: "shift <project> <id> <offset>",
    flags: [],
    example: 'capcut-david shift "<draft-dir>" <segment-id> +0.5s',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "shift-all",
    category: "editer",
    summary: "Décale tous les segments d'une piste (ou de tout le draft) d'un même offset.",
    signature: "shift-all <project> <offset> [--track <type>]",
    flags: [{ flag: "--track <type>", desc: "restreint le décalage à un type de piste" }],
    example: 'capcut-david shift-all "<draft-dir>" +1s --track audio',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "speed",
    category: "editer",
    summary: "Change la vitesse de lecture d'un segment.",
    signature: "speed <project> <id> <multiplier>",
    flags: [],
    example: 'capcut-david speed "<draft-dir>" <segment-id> 1.5',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "volume",
    category: "editer",
    summary: "Fixe le niveau de volume d'un segment audio (0.0-1.0).",
    signature: "volume <project> <id> <level>",
    flags: [],
    example: 'capcut-david volume "<draft-dir>" <segment-id> 0.8',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "trim",
    category: "editer",
    summary: "Coupe un segment à un nouveau départ/durée (temps en secondes).",
    signature: "trim <project> <id> <start> <duration>",
    flags: [],
    example: 'capcut-david trim "<draft-dir>" <segment-id> 0.5s 2s',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "opacity",
    category: "editer",
    summary: "Fixe l'opacité d'un segment (0.0-1.0).",
    signature: "opacity <project> <id> <alpha>",
    flags: [],
    example: 'capcut-david opacity "<draft-dir>" <segment-id> 0.5',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "remove-segment",
    category: "editer",
    summary:
      "Retire un segment de sa piste (piste supprimée si vidée), puis balaye les matériaux texte/vidéo/audio orphelins via le plan gc — un matériau encore référencé par un autre segment n'est jamais supprimé.",
    signature: "remove-segment <project> <segment-id>",
    flags: [],
    example: 'capcut-david remove-segment "<draft-dir>" <segment-id>',
    readOnly: false,
    capcutClosed: true,
    since: "2.5.0",
  },
  {
    verb: "cut",
    category: "editer",
    summary: "Découpe un projet long-format en un extrait court, écrit dans un nouveau chemin.",
    signature: "cut <project> <start> <end> --out <path>",
    flags: [{ flag: "--out <path>", desc: "chemin de sortie du draft découpé" }],
    example: 'capcut-david cut "<draft-dir>" 10s 40s --out ./extrait',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },
  {
    verb: "batch",
    category: "editer",
    summary: "Exécute plusieurs éditions à la suite depuis stdin (JSONL), une opération par ligne.",
    signature: "batch <project>",
    flags: [],
    example: 'capcut-david batch "<draft-dir>" < edits.jsonl',
    readOnly: false,
    capcutClosed: true,
    since: "0.1.0",
  },

  // ---- animer ----------------------------------------------------------
  {
    verb: "ken-burns",
    category: "animer",
    summary:
      "Pose un zoom Ken Burns sur UN segment : paire de keyframes scale_x/scale_y de t=0 à la fin du segment, easing cubic-out (parité CapCut prouvée).",
    signature: "ken-burns <project> <id> --from <scale> --to <scale> [--curve <c>]",
    flags: [
      { flag: "--from / --to <scale>", desc: "échelle départ/arrivée (ex. 1.0 → 1.08)" },
      { flag: "--curve <c>", desc: "courbe d'easing (défaut : ease-out)" },
    ],
    example: 'capcut-david ken-burns "<draft-dir>" <segment-id> --from 1.0 --to 1.08',
    readOnly: false,
    capcutClosed: true,
    since: "0.3.0",
  },
  {
    verb: "add-keyframe",
    category: "animer",
    summary:
      "Insère/remplace un keyframe générique sur une propriété (scale_x, scale_y, position_x, position_y, rotation, alpha). --batch pose plusieurs keyframes en un seul save.",
    signature:
      "add-keyframe <project> <id> <time> --property <p> --value <v> [--curve <c>] | add-keyframe <project> --batch @entries.json",
    flags: [
      { flag: "--property <p>", desc: "scale_x | scale_y | position_x | position_y | rotation | alpha" },
      { flag: "--value <v>", desc: "valeur de la propriété au temps donné" },
      { flag: "--curve <c>", desc: "linear (défaut) | ease-in | ease-out | ease-in-out" },
      {
        flag: "--batch @entries.json",
        desc: "[{segment_id,property,keyframes:[{time,value,curve?}]}] — tout-ou-rien, un seul save, since 2.1.0",
        since: "2.1.0",
      },
    ],
    example: 'capcut-david add-keyframe "<draft-dir>" <segment-id> 0s --property scale_x --value 1.0',
    readOnly: false,
    capcutClosed: true,
    since: "0.3.0",
  },
  {
    verb: "add-effect",
    category: "animer",
    summary: "Applique un effet vidéo (FX) via son resource_id de catalogue, sur une plage temporelle donnée.",
    signature: "add-effect <project> <resource-id> <name> (<start> <duration> | --full) [--value <n>] [--bind <segment-id>]",
    flags: [
      { flag: "--value <n>", desc: "intensité/paramètre de l'effet" },
      { flag: "--bind <segment-id>", desc: "segment auquel lier l'effet" },
      { flag: "--full", desc: "applique sur toute la timeline (remplace <start> <duration>)", since: "2.5.0" },
    ],
    example: 'capcut-david add-effect "<draft-dir>" 123456 "Glitch" 0s 2s',
    readOnly: false,
    capcutClosed: true,
    since: "1.1.0",
  },
  {
    verb: "add-filter",
    category: "animer",
    summary:
      "Applique un filtre (famille Filters, distincte des effets vidéo) via son resource_id de catalogue, sur une plage temporelle donnée.",
    signature: "add-filter <project> <resource-id> <name> (<start> <duration> | --full) [--value <n>]",
    flags: [
      { flag: "--value <n>", desc: "intensité du filtre [0,1]" },
      { flag: "--full", desc: "applique sur toute la timeline (remplace <start> <duration>)", since: "2.5.0" },
    ],
    example: 'capcut-david add-filter "<draft-dir>" 7083809725615247874 "Western" 0s 60s',
    readOnly: false,
    capcutClosed: true,
    since: "2.4.0",
  },

  // ---- reparer ----------------------------------------------------------
  {
    verb: "validate",
    category: "reparer",
    summary:
      "Linter en lecture seule : détecte refs cassées, orphelins, ids dupliqués, durées zéro/sous/sur, chevauchements avant d'ouvrir CapCut. --fix --apply écrit — CapCut fermé requis (agrège tous les fixers en un passage).",
    signature:
      "validate <project> [-H] [-q] [--strict] [--id <id>] [--skip <id>] [--check-assets] [--check-timelines] [--projects-root <dir>] | validate <project> --fix [--apply]",
    flags: [
      { flag: "--strict", desc: "promeut les warnings au code d'échec" },
      { flag: "--id <id> / --skip <id>", desc: "filtre les findings (répétable)" },
      { flag: "--check-assets", desc: "vérifie l'existence des fichiers médias sur disque (opt-in)" },
      { flag: "--check-timelines", desc: "vérifie la divergence des mirrors Timelines/ (opt-in)" },
      {
        flag: "--fix --apply",
        desc: "agrège gc→init-meta→register→sync-timelines et ÉCRIT — CapCut fermé requis. Sans --apply : dry-run, zéro écriture.",
        since: "1.12.0",
      },
    ],
    example: 'capcut-david validate "<draft-dir>" --strict',
    readOnly: true,
    capcutClosed: false,
    since: "1.8.0",
  },
  {
    verb: "sync-timelines",
    category: "reparer",
    summary:
      "Répare un mirror de timeline CapCut périmé : recopie le draft_content.json racine dans chaque Timelines/<guid>/. Corrige timelines.divergence de validate.",
    signature: "sync-timelines <project> [--dry-run] [-H] [-q] [--force]",
    flags: [{ flag: "--dry-run", desc: "rapporte sans écrire" }],
    example: 'capcut-david sync-timelines "<draft-dir>"',
    readOnly: false,
    capcutClosed: true,
    since: "1.9.0",
  },
  {
    verb: "gc",
    category: "reparer",
    summary:
      "Supprime les matériaux texte/vidéo/audio orphelins (orphan_text/orphan_media de validate) — JSON seulement, jamais un fichier disque. Refuse sur un draft dangling-ref/duplicate-id.",
    signature: "gc <project> [--dry-run] [-H] [-q] [--force]",
    flags: [{ flag: "--dry-run", desc: "prévisualise sans écrire" }],
    example: 'capcut-david gc "<draft-dir>" --dry-run',
    readOnly: false,
    capcutClosed: true,
    since: "1.10.0",
  },

  // ---- decouvrir ----------------------------------------------------------
  {
    verb: "query",
    category: "decouvrir",
    summary:
      "Recherche un effet/filtre/transition/police par nom dans toute la bibliothèque de drafts CapCut, renvoie son resource_id. Lecture seule.",
    signature: "query <term> [--kind effect|filter|transition|font] [--drafts <dir>]",
    flags: [
      { flag: "--kind <k>", desc: "restreint à effect | filter | transition | font" },
      { flag: "--drafts <dir>", desc: "root de la bibliothèque de drafts à scanner" },
    ],
    example: "capcut-david query glitch --kind effect",
    readOnly: true,
    capcutClosed: false,
    since: "1.13.0",
  },
  {
    verb: "info",
    category: "decouvrir",
    summary: "Vue d'ensemble du projet : résumé des matériaux et informations générales du draft.",
    signature: "info <project>",
    flags: [],
    example: 'capcut-david info "<draft-dir>"',
    readOnly: true,
    capcutClosed: false,
    since: "0.1.0",
  },
  {
    verb: "tracks",
    category: "decouvrir",
    summary: "Liste toutes les pistes du draft (type, nom, nombre de segments).",
    signature: "tracks <project>",
    flags: [],
    example: 'capcut-david tracks "<draft-dir>"',
    readOnly: true,
    capcutClosed: false,
    since: "0.1.0",
  },
  {
    verb: "segments",
    category: "decouvrir",
    summary: "Liste les segments avec leur timing, filtrable par type de piste.",
    signature: "segments <project> [--track <type>]",
    flags: [{ flag: "--track <type>", desc: "restreint à un type de piste" }],
    example: 'capcut-david segments "<draft-dir>" --track video',
    readOnly: true,
    capcutClosed: false,
    since: "0.1.0",
  },
  {
    verb: "materials",
    category: "decouvrir",
    summary: "Liste tous les types de matériaux et leurs comptes, ou le détail d'un type donné.",
    signature: "materials <project> [--type <type>]",
    flags: [{ flag: "--type <type>", desc: "liste les items d'un type de matériau donné" }],
    example: 'capcut-david materials "<draft-dir>" --type videos',
    readOnly: true,
    capcutClosed: false,
    since: "0.1.0",
  },
  {
    verb: "segment",
    category: "decouvrir",
    summary: "Détail complet d'un segment et de son matériau associé.",
    signature: "segment <project> <id>",
    flags: [],
    example: 'capcut-david segment "<draft-dir>" <segment-id>',
    readOnly: true,
    capcutClosed: false,
    since: "0.1.0",
  },
  {
    verb: "material",
    category: "decouvrir",
    summary: "Détail complet d'un matériau.",
    signature: "material <project> <id>",
    flags: [],
    example: 'capcut-david material "<draft-dir>" <material-id>',
    readOnly: true,
    capcutClosed: false,
    since: "0.1.0",
  },
  {
    verb: "ui",
    category: "decouvrir",
    summary:
      "Ouvre cette carte des capacités dans le navigateur (page embarquée dans le paquet — toujours synchro avec la version installée).",
    signature: "ui [--print-path]",
    flags: [{ flag: "--print-path", desc: "affiche le chemin de la page sans l'ouvrir" }],
    example: "capcut-david ui",
    readOnly: true,
    capcutClosed: false,
    since: "2.2.0",
  },
];

export const CHAINS: Chain[] = [
  {
    name: "Montage Stickman / épisode v1 (Shared/montage-tools assemble_draft.py)",
    steps: [
      { verb: "init", note: "draft 1080×1920" },
      { verb: "init-meta", note: "--register : sidecar meta + indexation CapCut" },
      { verb: "add-video", note: "--batch @video_infos.json — tous les plans, UN save" },
      { verb: "add-audio", note: "narration à 0s" },
      { verb: "add-text", note: "caption factice = support de style" },
      { verb: "restyle", note: "gabarit (CC-DerStil…) sur la factice" },
      { verb: "import-captions", note: "--clone-style --transform-y — captions finales" },
      { verb: "add-keyframe", note: "--batch : Ken Burns sur les plans image" },
      { verb: "sync-timelines", note: "réconcilie les mirrors" },
      { verb: "validate", note: "gate final avant d'ouvrir CapCut" },
    ],
  },
  {
    name: "Repost Amélioré phase 5 (b-roll sous la voix)",
    steps: [
      { verb: "init", note: "d_<slug> 1080×1920" },
      { verb: "init-meta", note: "--register" },
      { verb: "add-audio", note: "narration.mp3" },
      { verb: "import-captions", note: "captions-styled.json (jaune natif)" },
      { verb: "restyle", note: "gabarit derstil" },
      { verb: "add-video", note: "--batch @_video_infos.json — 25 clips b-roll" },
      { verb: "validate", note: "rc 0 → ouvrir CapCut" },
    ],
  },
  {
    name: "psycho-build (tout-en-un images + voix + musique + SRT)",
    steps: [{ verb: "psycho-build", note: "images + ken-burns + narration + musique + captions SRT en un verbe" }],
  },
];
