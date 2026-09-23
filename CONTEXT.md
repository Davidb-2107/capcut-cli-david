# CapCut CLI David

Un CLI local-first qui fabrique et modifie des drafts CapCut (projets JSON) avec précision — CapCut rend la vidéo. Mono-utilisateur assumé, Windows-first, la route produit est « drafts-first » (ADR 0002, mémo 2026-09-22).

## Language

**Draft**:
Le projet CapCut sur disque (dossier avec `draft_content.json`) — le livrable du CLI et la source de vérité.
_Avoid_: projet, film, timeline (au singulier, ambigu)

**Mirror (timeline mirror)**:
Copie de `draft_content.json` (ou `draft_info.json`) sous `Timelines/<guid>/` que CapCut lit à l'ouverture ; le CLI la réconcilie depuis le draft racine (`sync-timelines`).
_Avoid_: copie, backup

**Rollback (racine `.bak`)** :
Le fichier `<draft>/draft_content.json.bak` écrit par le `DraftStore` à chaque édition racine ; il contient les **octets d'avant l'écriture** (indent d'origine). C'est l'unique undo de la dernière écriture — le miroir de police (`mirrorFont`) ne doit **jamais** l'écraser, et `sync-timelines` le préserve explicitement.
_Avoid_: backup (concept CapCut distinct), copie

**Handler**:
Fonction qui exécute un verbe de la CLI, appelée par le dispatcher ; à terme enregistrée dans le registry plutôt que câblée en `case` dans `index.ts`.
_Avoid_: commande (réservé au verbe vu par l'utilisateur), action

**Registry**:
La `Map<verb, handler>` de `index.ts` qui remplace le switch de 34 cases et centralise la sortie (exit codes via `process.exitCode`, pas de `process.exit()` épars).
_Avoid_: dispatcher (le dispatcher est le code qui *utilise* le registry)

**Façade (saveDraft/loadDraft)**:
Les fonctions globales dépréciées de `draft.ts` qui masquent un `DraftStore` via la map `loadedByPath` ; leur suppression est le critère de fin de la migration DraftStore.
_Avoid_: API de sauvegarde (trop vague)

**DraftStore**:
Le port d'accès aux drafts (interface `load`/`save`, implémentation `LocalDraftStore`) injectable pour les tests ; le seul chemin de persistance après migration.
_Avoid_: store (seul, ambigu)

**Golden-output check**:
Filet de caractérisation : stdout/stderr/exit code des commandes read-only sur fixtures, diff avant/après avec canonicalisation des UUIDs/chemins — la preuve mécanique qu'un refactor préserve le comportement.
_Avoid_: snapshot tests (terme différent : les snapshots incluent le DOM/état, ici c'est la sortie CLI)
