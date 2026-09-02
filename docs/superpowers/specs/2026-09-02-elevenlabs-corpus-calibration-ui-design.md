# Interface locale de création et calibration du corpus ElevenLabs

**Date :** 2026-09-02  
**Statut :** design proposé pour validation avant implémentation

## Objectif

Construire une application web locale permettant de créer et publier un corpus
canonique de textes standards, de lancer une calibration ElevenLabs unique et
de publier explicitement le WPM obtenu dans un profil de voix réutilisable.

L’architecture locale doit pouvoir devenir une application SaaS sans changer le
parcours utilisateur, les modèles métier ni le cœur `run_calibration`.

## Décisions actées

- Le développement local utilise le BYOK : la clé utilisateur est lue depuis
  `.env` par le backend local.
- La production SaaS utilise une clé serveur et pourra refacturer les runs.
- Le corpus est canonique, commun à toutes les voix et utilisé en entier pour
  chaque calibration.
- Une modification du corpus produit une nouvelle version publiée ; une version
  publiée est immuable.
- L’audio de référence humain n’appartient pas au MVP : les textes standards
  sont envoyés à ElevenLabs.
- Une calibration produit un WPM et un rapport traçable.
- Le rapport est immuable ; le profil de voix est mis à jour séparément par une
  action explicite de publication.
- `run_calibration` et les contrats MCP sont la source de vérité pour les
  paramètres, les valeurs par défaut, les validations et les métriques.
- `postproc` est toujours transmis explicitement.
- Le dry-run est obligatoire et doit être approuvé explicitement avant tout run
  réel.
- L’interface ne contient ni appel direct à ElevenLabs/MCP, ni logique métier de
  calibration.

## Hors périmètre MVP

- comparaison A/B ou exécution de plusieurs variantes dans un même parcours ;
- scoring ou recalcul du WPM dans le frontend ;
- édition directe de paramètres ElevenLabs en dehors du schéma MCP ;
- import d’enregistrements humains de référence ;
- comptes, équipe, quotas et facturation côté local ;
- exécution locale concurrente de plusieurs calibrations ;
- worker distant, file de jobs et stockage objet ;
- traitement audio ajouté par l’interface lorsque le cœur ne le produit pas déjà.

## Architecture

```text
Navigateur
    │ HTTP/JSON, même API en local et en SaaS
    ▼
API applicative versionnée
    ▼
Services d’application
    ├── CalibrationRunner ──► CalibrationBridge ──► run_calibration / MCP
    ├── CorpusRepository
    ├── CalibrationRunRepository
    ├── VoiceProfileRepository
    ├── ArtifactStore
    └── CredentialProvider
```

Le navigateur ne connaît ni la clé, ni le fournisseur ElevenLabs, ni la logique
de mesure. L’API applicative orchestre le parcours, mais délègue les règles
fonctionnelles au contrat MCP et au cœur de calibration.

Le `CalibrationRunner` ne suppose pas que le cœur soit écrit en TypeScript :
il passe par un `CalibrationBridge` qui encapsule le pont Node/TypeScript ↔
Python. Le transport réel — serveur MCP en stdio, subprocess Python direct ou
appel HTTP intermédiaire — sera choisi uniquement après la gate de contrat et
reste invisible pour l’UI. Le bridge possède le cycle de vie du processus, le
framing des messages, la propagation stderr/exit code, les timeouts,
l’annulation et la résolution de l’environnement Python.

Les ports permettent de remplacer les implémentations sans modifier l’UI ni
les services :

| Port | Local | SaaS |
| --- | --- | --- |
| `CredentialProvider` | clé depuis `.env` | clé serveur ou secret manager |
| `CorpusRepository` | fichiers JSON locaux | base de données |
| `CalibrationRunRepository` | fichiers JSON locaux | base de données |
| `ArtifactStore` | répertoire local | stockage objet |
| `CalibrationRunner` | utilise le `CalibrationBridge` vers le cœur/MCP | même bridge derrière un worker si nécessaire |

Le backend local écoute uniquement sur `127.0.0.1` par défaut. Le déploiement
SaaS ajoute l’authentification et le contrôle d’accès à l’entrée de la même API.

### Gate de contrat avant implémentation

Avant de construire l’API ou le formulaire, une tâche bloquante doit identifier
la source réelle de `run_calibration` et des contrats MCP : dépôt ou package,
révision/commit, méthode d’import, schéma d’entrée, champs obligatoires,
valeurs par défaut, sémantique du dry-run, format du résultat, erreurs et
garantie d’idempotence du runner/provider. Cet inventaire doit être enregistré
comme artefact de référence du projet. Le plan MVP ne peut pas franchir cette
gate avec des types provider-specific inventés.

## Modèle métier

### Corpus de travail et versions

Chaque ressource persistée porte un `workspace_id`. En local, il désigne un
workspace local unique ; en SaaS, il devient la portée d’autorisation et de
propriété du corpus, des runs, des profils et des artefacts.

Le corpus de travail est modifiable. La publication crée un snapshot immuable
contenant les textes, leur identifiant stable, leur ordre et un checksum du
contenu. Une seule version est active pour les nouvelles calibrations.

Une version publiée ne peut pas être modifiée ni supprimée par l’interface.
Une édition ultérieure repart d’une copie de la version active et produit une
nouvelle version à publier. Une calibration ne peut référencer qu’une version
publiée.

### CalibrationRun

Un run conserve au minimum :

- son identifiant et sa clé d’idempotence ;
- la voix et le modèle ciblés ;
- l’identifiant et le checksum de la `CorpusVersion` ;
- la requête MCP résolue, sans secret ;
- la version du contrat et du cœur utilisés ;
- la valeur explicite de `postproc` ;
- l’empreinte de la requête résolue ;
- les événements d’approbation et d’exécution ;
- le résultat, les métriques et les artefacts ;
- l’erreur structurée éventuelle.

Les états sont :

```text
draft → dry_run_ready → approved → running → succeeded | failed | execution_unknown
```

`execution_unknown` signifie que la requête a pu être acceptée par le provider
mais que la réponse n’est pas connue, par exemple après un timeout. Cet état
interdit tout retry automatique. Une reprise exige la procédure de
réconciliation prévue par le runner/provider ; si aucune garantie d’idempotence
externe n’existe, elle nécessite une décision manuelle explicite.

Un retry autorisé d’un run existant réutilise son identifiant et sa clé
d’idempotence. Créer un nouveau run est une action explicite et produit une
nouvelle clé.

### VoiceProfile

Un profil contient le fournisseur, le `voice_id`, le WPM publié, l’identifiant
du run source, la version du corpus, la date de publication et le contexte de
mesure nécessaire à son interprétation. Les anciens profils restent
consultables ; la publication change explicitement le profil courant.

## Flux utilisateur et règles de sûreté

1. L’application affiche l’état de la configuration locale. Une clé absente ou
   invalide désactive le parcours de calibration sans révéler la clé.
2. L’utilisateur édite le corpus de travail et publie une nouvelle version.
3. L’utilisateur prépare une calibration sur la version active.
4. Le backend expose le schéma du contrat MCP. L’UI rend les champs obligatoires
   et les champs optionnels, sans recopier leurs validations ni leurs défauts.
5. Le backend construit la requête complète et invoque le mécanisme de dry-run
   prévu par le cœur/contrat. L’UI ne simule jamais le dry-run.
6. Le backend canonise la requête et calcule une empreinte SHA-256 comprenant la
   version et le digest du contrat, la version et le digest du cœur, la version
   du corpus, la voix, tous les paramètres et `postproc`.
7. L’UI montre la requête finale, les valeurs par défaut appliquées, la version
   du corpus, l’empreinte et les avertissements. L’utilisateur approuve.
8. L’exécution refuse toute approbation dont l’empreinte ne correspond plus à
   la requête, au corpus, au contrat ou au cœur courant. L’approbation possède
   une expiration et est consommée de façon atomique avec le passage à
   `running` ; elle ne peut servir qu’à un run.
9. Le backend réserve atomiquement le run puis demande au `CalibrationBridge`
   d’exécuter le snapshot approuvé avec le même identifiant d’idempotence. Si
   le transport perd la réponse après émission, le run devient
   `execution_unknown` ; le rapport reste incomplet et aucun profil n’est écrit
   automatiquement.
10. Après succès, l’utilisateur clique explicitement sur « Publier comme
    profil ». Le profil référence le rapport source et son WPM.

La canonisation doit être déterministe : clés JSON ordonnées, représentation
stable des valeurs et absence de champs non significatifs. Le snapshot approuvé
est conservé et c’est lui qui est exécuté ; le backend ne reconstruit pas une
nouvelle requête depuis l’état courant au moment de l’exécution. Le format exact
est une décision d’implémentation à aligner sur les utilitaires déjà présents
dans le projet, pas une règle recodée dans le frontend.

## API applicative

Les routes suivantes décrivent la frontière applicative. Les noms et types de
paramètres de calibration devront être dérivés du contrat MCP réel avant toute
implémentation.

```text
GET  /api/v1/bootstrap
GET  /api/v1/corpus
GET  /api/v1/corpus/draft
PUT  /api/v1/corpus/draft
POST /api/v1/corpus/versions
GET  /api/v1/calibration/schema
POST /api/v1/calibration-runs/dry-run
POST /api/v1/calibration-runs/:id/approve
POST /api/v1/calibration-runs/:id/execute
GET  /api/v1/calibration-runs/:id
POST /api/v1/voice-profiles
GET  /api/v1/voice-profiles
```

Ces routes transportent des DTO applicatifs. Elles ne deviennent pas une
seconde définition des contrats MCP : l’adaptateur traduit les DTO vers le
contrat source et renvoie les erreurs structurées du cœur.

## Interface utilisateur

### Accueil

Affiche l’état de `.env`, la version active du corpus, les profils disponibles
et les derniers runs. Les secrets sont toujours masqués.

### Corpus

Affiche les textes standards avec identifiant stable et ordre. L’utilisateur
peut modifier et enregistrer le brouillon, publier une version et consulter
l’historique. L’enregistrement utilise une révision ou un `ETag` pour détecter
un conflit. La publication crée atomiquement le snapshot ; les versions
publiées sont en lecture seule.

### Préparation

Affiche la voix, la version du corpus figée, les paramètres issus du schéma MCP
et une sélection `postproc` obligatoire. Les champs optionnels peuvent être
regroupés, mais leur présence et leur défaut viennent du schéma.

### Dry-run

Affiche la requête complète résolue, les valeurs par défaut, la version du
contrat, l’empreinte et les avertissements. Le bouton d’approbation est distinct
de toute action d’exécution.

### Résultat

Affiche l’état du run, le WPM, les autres métriques, les erreurs structurées et
les liens vers les artefacts produits par le cœur. Le bouton de publication du
profil est séparé.

## Erreurs et idempotence

- Une clé absente, invalide ou inaccessible n’entraîne aucun appel réel.
- Une erreur de schéma ou de validation bloque le dry-run.
- Un timeout après émission de la requête passe le run à
  `execution_unknown`. Il ne déclenche pas de retry aveugle ; seule la
  réconciliation prévue par le runner/provider peut autoriser une reprise.
- Un résultat incomplet ou sans WPM laisse le run consultable mais interdit la
  publication du profil.
- Une modification du corpus ou de la requête invalide toute approbation
  antérieure.
- Un double clic ou un retry réseau ne doit pas créer un second run facturable.
- Un échec conserve le rapport et laisse le profil courant inchangé.

Le rapport et les logs ne contiennent jamais `ELEVENLABS_API_KEY`. Les erreurs
peuvent contenir les identifiants de run et de voix, mais pas de credential.
L’UI et l’API sont servies en same-origin en local. Le serveur refuse les
origines CORS larges et exige un nonce de session sur les mutations afin qu’une
page externe ne puisse pas déclencher un run local par simple requête.

## Tests et critères d’acceptation

Les tests doivent couvrir :

- publication et immutabilité des versions de corpus ;
- lecture et enregistrement concurrents du brouillon avec révision/`ETag` ;
- rejet d’une calibration sur un brouillon ;
- génération du formulaire depuis le schéma MCP ;
- résolution et affichage des paramètres complets ;
- calcul d’empreinte déterministe ;
- invalidation après changement de corpus, paramètre, `postproc` ou contrat ;
- transitions d’état valides et refus des transitions impossibles ;
- idempotence des retries et blocage de `execution_unknown` sans réconciliation ;
- approbation expirée, consommée une seule fois et refusée après divergence de
  digest ;
- conservation d’un rapport sans publication automatique ;
- publication explicite d’un profil avec WPM et run source ;
- absence de clé dans les réponses HTTP, logs et artefacts ;
- parcours API complet avec un faux `CalibrationRunner` ;
- bridge Node/Python testé avec un faux processus ou transport, incluant
  framing, timeout, stderr et codes de sortie.

Le parcours MVP est accepté lorsque l’on peut créer une version du corpus,
préparer un run, voir un dry-run complet, l’approuver, l’exécuter une seule
fois, consulter son WPM et publier explicitement un profil qui reste traçable
après une nouvelle version du corpus.

## Stratégie de migration SaaS

La première implémentation doit conserver une API `/api/v1` identique entre
local et SaaS. La migration remplace les adaptateurs de credentials et de
stockage, puis ajoute authentification, autorisation, quotas, facturation et
jobs asynchrones autour du même service d’application.

Les entités portent déjà un `workspace_id`. Le contexte d’exécution prévoit
également un scope de credential et un sujet de facturation, absents ou fixes
en local mais renseignés en SaaS. Les événements de facturation seront liés au
run et au résultat confirmé par le runner, jamais à un clic ou à un retry du
navigateur.

Ces champs et garde-fous sont conservés dès le local parce qu’ils stabilisent
la migration, mais leur implémentation locale reste minimale : un
`workspace_id` fixe, une révision entière ou un `ETag` simple, un hash
déterministe local et aucune infrastructure distribuée. La réconciliation de
`execution_unknown` est un état et une action manuelle, pas un service de jobs
à construire dans le MVP.

Le frontend ne doit contenir aucune hypothèse de chemin local, de système de
fichiers, de `.env` ou d’exécution synchrone. Le backend local ne doit pas
exposer de contrat provider-specific au navigateur.

## Précondition avant implémentation

Le dépôt inspecté ne contient pas actuellement `run_calibration`, les contrats
MCP ElevenLabs ni un backend HTTP ; `src/commands/ui.ts` ouvre aujourd’hui un
HTML statique. La première tâche d’implémentation est donc la gate de contrat
et de bridge : identifier le dépôt/package Python `voice-calibration/`, sa
révision, son point d’entrée, son transport MCP réel, son framing, son
environnement d’exécution, ses paramètres, ses valeurs par défaut, son
mécanisme de dry-run, son format de résultat, ses erreurs, ses timeouts et sa
garantie d’idempotence. Les types du backend et les routes de calibration ne
sont autorisés qu’après cet inventaire. Aucun nom de champ provider-specific,
aucun transport et aucun protocole Node/Python ne doit être figé avant cette
vérification.
