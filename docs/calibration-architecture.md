# Architecture du MVP de calibration ElevenLabs

**Statut :** architecture implémentée
**Dernière vérification :** 2026-09-05
**Périmètre de production :** `src/calibration/`, `src/ui/calibration-client.ts`,
`src/calibration-cli.ts` et `src/calibration/entrypoint.ts`

Le paquet est autonome : son identité est `voice-calibration` et son point
d’entrée est `dist/calibration-cli.js`. L’ancien mode intégré au projet vidéo
n’est plus le chemin documenté ni le chemin compilé par défaut ; l’adaptateur
conservé dans `src/commands/` sert seulement à préserver une transition locale
pendant le nettoyage de l’ancien dépôt.

Ce document décrit les composants réellement utilisés par le MVP local. Il
sert de référence pour comprendre le flux, remplacer une dépendance ou
préparer une évolution SaaS sans déplacer les garanties métier dans le
navigateur.

## Vue d’ensemble

```text
Navigateur local
  calibration.html + calibration-client.js
              │ HTTP/JSON same-origin
              ▼
       http-server.ts
              │ routes /api/v1
              ▼
   CalibrationApplication
       ├── domain.ts              états et transitions
       ├── LocalStore              corpus, runs, profils, rapports
       ├── CalibrationBridge       pont Node → MCP/Python
       ├── CredentialProvider       .env, statut, redaction
       ├── VoiceDirectoryPort       nom ElevenLabs côté serveur
       └── CanonicalProfilePort      source Python WPM
              │
              ├── voice-calibration-mcp → run_calibration
              └── GET /v1/voices/:voice_id
```

Le navigateur ne connaît ni la clé, ni le protocole MCP, ni le chemin Python,
ni les règles de transition. Il ne fait que demander des vues et déclencher
des commandes HTTP.

## Responsabilités par couche

### Interface web

Fichiers :

- `src/ui/calibration-template.html`
- `src/ui/calibration-client.ts`

Le template fournit les vues : configuration, corpus, préparation, simulation,
résultat et profils. Le client garde uniquement un état de session en mémoire,
envoie le nonce sur les mutations et rend les réponses de l’API.

Le client applique les choix UX du MVP : modèle v2 fixe, protocole fixe, corpus
en lecture seule, résultat humain et publication séparée. Il ne doit pas
devenir une seconde implémentation du contrat de calibration.

Le client appelle uniquement des chemins relatifs `/api/v1/...`. La clé API et
les imports Node restent absents du bundle navigateur.

### Serveur HTTP

Fichier : `src/calibration/http-server.ts`

Le serveur :

- sert les fichiers statiques de l’interface ;
- vérifie l’origine attendue ;
- impose le loopback par défaut et l’opt-in `--allow-network` pour un hôte
  non local ;
- crée un nonce de session fourni par `bootstrap` ;
- exige ce nonce pour les mutations ;
- traduit les erreurs métier en statuts HTTP ;
- redige les valeurs sensibles avant sérialisation ;
- refuse les chemins statiques inconnus et les traversées de répertoire.

Routes principales :

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/v1/bootstrap` | configuration, corpus actif, profils, runs récents |
| GET | `/api/v1/corpus` | draft, version active et versions |
| GET | `/api/v1/calibration/schema` | schéma réel du cœur MCP |
| POST | `/api/v1/calibration-runs/dry-run` | préparer et persister une simulation acceptée |
| POST | `/api/v1/calibration-runs/:id/approve` | approuver le digest du run |
| POST | `/api/v1/calibration-runs/:id/execute` | lancer une seule exécution réelle |
| POST | `/api/v1/calibration-runs/:id/reconcile` | réconciliation explicite d’un état inconnu |
| GET | `/api/v1/calibration-runs/:id` | run détaillé et rapport |
| GET | `/api/v1/voices/:voiceId` | récupérer le nom de la voix, sans exposer la clé |
| GET/POST | `/api/v1/voice-profiles` | lire ou publier les projections WPM |

Le endpoint de nom de voix ne fait transiter que `{ voiceRef, name }`. Il ne
sert pas de proxy général vers ElevenLabs.

### Service applicatif

Fichier : `src/calibration/application.ts`

`CalibrationApplication` orchestre les cas d’usage et garde le cœur métier à
l’extérieur du frontend :

1. `prepareDryRun()` exige la version active du corpus, récupère le schéma,
   construit la requête résolue, calcule son digest et demande une proposition
   au bridge ; le run n’est persisté qu’après acceptation.
2. `approve()` vérifie le digest reçu ou délègue l’approbation au cœur Python
   quand le run est core-backed.
3. `execute()` vérifie l’état, l’approbation, son expiration et les digests,
   consomme l’approbation avant l’appel provider, persiste le rapport et
   projette l’état terminal.
4. `getVoiceName()` valide l’ID, vérifie la configuration et utilise le port
   de répertoire de voix ; le secret ne quitte pas le backend.
5. `publishProfile()` n’accepte qu’un run réussi et demande une confirmation
   à la source Python canonique avant d’écrire la projection locale.

Le service utilise un verrou par run pour sérialiser les transitions locales.
La récupération au démarrage transforme un run persistant resté `running` en
`execution_unknown` plutôt que de le rejouer.

### Domaine

Fichier : `src/calibration/domain.ts`

Les types centraux sont :

- `CorpusDraft` et `CorpusVersion` ;
- `ResolvedCalibrationRequest` ;
- `CalibrationRun` et `CalibrationReport` ;
- `VoiceProfile` ;
- `RunStatus` et `transitionRun()`.

La requête résolue contient notamment le corpus versionné, son digest, la voix,
les paramètres, `postproc`, les digests du contrat/cœur et l’empreinte finale.
Le modèle d’état interdit les transitions incohérentes et les exécutions
répétées d’un état terminal.

### Ports et stockage

Fichier : `src/calibration/ports.ts`

Les interfaces isolent les effets :

| Port | Implémentation locale | Remplacement possible |
|---|---|---|
| `CorpusRepository` | JSON sous `corpus/` | base de données |
| `CalibrationRunRepository` | JSON sous `runs/` | base de données/job store |
| `VoiceProfileRepository` | JSON sous `profiles/` | base de données |
| `ArtifactStore` | fichiers sous `artifacts/` | stockage objet |
| `VoiceDirectoryPort` | API ElevenLabs côté serveur | client/secret manager SaaS |
| `CanonicalProfilePort` | `Shared/voice-calibration/voice_wpm.json` via Python | service WPM autoritatif |

Fichier : `src/calibration/local-store.ts`

Le nouveau répertoire de données par défaut est :

```text
~/.voice-calibration/elevenlabs-calibration/
└── workspaces/local-default/
    ├── corpus/
    │   ├── draft.json
    │   ├── active.json
    │   └── versions/<version-id>.json
    ├── runs/<run-id>.json
    ├── profiles/<profile-id>.json
    └── artifacts/<run-id>/report.json
```

Pour préserver les runs créés avant l’extraction, si ce nouveau répertoire
n’existe pas encore mais que l’ancien répertoire local existe, le runtime le
réutilise en lecture/écriture sans copier ni supprimer les données. Dès que le
nouvel emplacement est créé explicitement, il devient prioritaire.

Les écritures de corpus et de runs utilisent des fichiers temporaires,
renommage atomique, verrous et contrôles de frontières/symlinks. Les
références de profil local restent des projections : la valeur WPM autoritative
est validée depuis `Shared/voice-calibration/voice_wpm.json`.

## Pont vers le cœur de calibration

Fichier : `src/calibration/bridge.ts`

`createCalibrationBridge()` encapsule le processus
`voice-calibration-mcp` et son transport MCP JSON-RPC sur stdin/stdout. Il
gère :

- l’initialisation MCP et `tools/list` ;
- l’appel de `calibrate_voice` et des opérations de gate quand elles existent ;
- la corrélation des identifiants JSON-RPC ;
- la séparation stdout protocolaire / stderr diagnostique ;
- les timeouts ;
- la distinction entre échec avant émission et réponse perdue après émission ;
- la redaction récursive du secret dans les erreurs et diagnostics ;
- la fermeture propre du processus.

Le bridge ne recalcule pas le WPM et ne crée pas un second fichier canonique.
Il transporte les métriques et le résultat du cœur vers le service applicatif.

## Credentials et nom de voix

Fichier : `src/calibration/credentials.ts`

`createCredentialProvider()` cherche `ELEVENLABS_API_KEY` selon la convention
du projet et expose seulement un statut public ou un secret au code serveur qui
doit l’utiliser.

`createVoiceDirectoryProvider()` utilise la clé dans l’en-tête
`xi-api-key` pour appeler :

```text
GET https://api.elevenlabs.io/v1/voices/<voice_id>
```

Le provider extrait uniquement `name`. Les réponses d’erreur et le body brut
de la réponse ElevenLabs ne sont pas envoyés au navigateur. La documentation
officielle décrit cette route comme la récupération d’une voix par son ID :
[Get voice](https://elevenlabs.io/docs/api-reference/voices/get).

## Flux d’exécution et invariants

```text
Corpus publié
    ↓
prepareDryRun → request snapshot + digest + proposal
    ↓ approbation explicite, TTL 15 min
approved
    ↓ consommation atomique de l’approbation
running → bridge/MCP → rapport persisté
    ├── succeeded → résultat consultable → publication WPM explicite
    ├── failed → résultat conservé, profil inchangé
    └── execution_unknown → aucune relance automatique
```

Les invariants à préserver lors d’une évolution sont :

1. le texte actif envoyé au cœur vient exclusivement du corpus publié ;
2. l’exécution utilise le snapshot approuvé, pas une requête reconstruite ;
3. l’approbation est consommée avant l’appel facturable ;
4. `execution_unknown` n’est jamais rejoué automatiquement ;
5. le profil local n’est écrit qu’après validation de la source WPM canonique ;
6. aucun secret n’entre dans le navigateur, les arguments MCP ou les artefacts
   persistés.

## Construction de l’interface

Le script `scripts/build-calibration-ui.mjs` :

1. vérifie la présence du template et du client TypeScript compilé ;
2. retire l’export vide éventuellement produit par TypeScript ;
3. refuse un `import`/`export` runtime ou un `import(` dynamique dans le
   bundle navigateur ;
4. remplace le marqueur de build du template ;
5. écrit `dist/ui/calibration.html`.

La commande `npm run build` compile d’abord TypeScript puis assemble l’UI. Le
serveur sert les fichiers générés sous `dist/ui`.

## Tests et points de remplacement

Les tests couvrent séparément :

- les transitions et invariants du domaine ;
- le bridge et la non-exposition des credentials ;
- le stockage persistant et la récupération d’un run interrompu ;
- l’API HTTP, le nonce, l’ETag, l’origine et les chemins sûrs ;
- le client UI, la restauration du dernier run et le rendu sans JSON brut ;
- le parcours end-to-end.

Pour vérifier l’ensemble avant une évolution :

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

Une évolution SaaS devrait remplacer les ports de stockage et de credentials,
ajouter l’authentification à la frontière HTTP et déplacer l’exécution vers un
worker si nécessaire. Elle ne devrait pas déplacer les transitions, le digest,
la consommation d’approbation ou la validation WPM dans le navigateur.
