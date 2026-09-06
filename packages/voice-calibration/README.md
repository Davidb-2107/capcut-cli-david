# voice-calibration

MVP local partagé pour calibrer les voix ElevenLabs à partir d’un corpus
standard publié et produire un profil WPM canonique réutilisable par les
projets consommateurs.

## Lancer l’interface

Prérequis : Node.js 18+, `voice-calibration-mcp` dans le `PATH`, et la clé
`ELEVENLABS_API_KEY` dans le `.env` déjà utilisé par l’environnement. La clé
reste dans le backend ; elle n’est jamais demandée au navigateur.

Le paquet vit dans le workspace npm du dépôt (`packages/voice-calibration`).
Depuis la racine du dépôt :

```bash
npm install            # installe les workspaces
npm run build          # compile d'abord voice-calibration, puis le CLI
npx voice-calibration --open
```

Via l’entrée CLI officielle du moteur, l’adaptateur équivalent est :

```bash
capcut-david calibration-ui --open
```

Options utiles :

```text
--data-dir <dir>       stockage local des runs et profils
--host <host>          adresse d’écoute
--port <port>          port d’écoute (0 = port libre)
--open                 ouvrir l’interface dans le navigateur
--allow-network        autoriser explicitement un bind non local
```

Le bind est local par défaut. L’interface impose le corpus publié, le
snapshot approuvé, le dry-run, l’approbation avant l’appel facturable,
l’idempotence des runs et la protection des secrets.

## Architecture

```text
Navigateur
    │ HTTP same-origin + nonce
    ▼
Serveur local `http-server.ts`
    │
    ▼
`CalibrationApplication`
    ├── domaine et transitions
    ├── stockage local atomique
    ├── bridge MCP/Python
    ├── credentials backend
    ├── nom de voix ElevenLabs
    └── publication WPM canonique
```

Le paquet vit dans `packages/voice-calibration` de ce dépôt ; le verbe
`capcut-david calibration-ui` du moteur est un adaptateur mince qui consomme
l’API publique du paquet. La source WPM autoritative reste dans
`Shared/voice-calibration/voice_wpm.json` (vault). Les projets CapCut ou
autres consommateurs utilisent ensuite les profils publiés ; ils ne sont pas
nécessaires pour lancer cet outil.

## Documentation

- [`docs/calibration-mvp.md`](./docs/calibration-mvp.md) — parcours utilisateur,
  protocole v2, corpus, dry-run, approbation et publication ;
- [`docs/calibration-architecture.md`](./docs/calibration-architecture.md) —
  composants, stockage, bridge, secrets et invariants ;
- [`docs/elevenlabs-calibration-contract-inventory.md`](./docs/elevenlabs-calibration-contract-inventory.md) —
  contrat observé du cœur de calibration.

## Vérification

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

La suite `test/calibration-*.test.mjs` vérifie le domaine, le stockage, le
bridge, l’API, le rendu UI, l’idempotence, la non-exposition des secrets et
l’identité autonome du paquet.
