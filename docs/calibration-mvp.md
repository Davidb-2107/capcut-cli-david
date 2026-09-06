# MVP de calibration ElevenLabs

**Statut :** implémenté localement
**Dernière vérification :** 2026-09-05
**Entrée principale :** `voice-calibration --open`

Ce document décrit le comportement du MVP tel qu’il existe dans le code. Les
documents de conception historiques peuvent contenir des idées qui ne sont pas
exposées par l’interface actuelle.

## Objectif

Le MVP mesure la vitesse de lecture d’une voix ElevenLabs à partir d’un corpus
de référence standard, puis permet de publier explicitement le WPM validé dans
le profil canonique utilisé par les traitements futurs.

Le parcours est volontairement étroit : une voix identifiée par son ID, un
corpus publié commun à toutes les voix, un protocole fixe et une approbation
avant toute génération audio facturable.

## Périmètre actuel

Le parcours local applique automatiquement :

| Élément | Valeur du MVP |
|---|---|
| Modèle | `eleven_multilingual_v2` |
| Langue | `fr` |
| Mode | `precision` |
| Répétitions | `3` |
| Post-traitement | `cut` |
| `stability` | `0.5` |
| `similarity_boost` | `0.85` |
| `style` | `0` |
| `use_speaker_boost` | `true` |

Le modèle Eleven v3 n’est pas proposé par cette interface : son calibrage
nécessite un corpus conçu pour les balises d’émotion et un protocole dédié.

## Prérequis

1. Node.js 18 ou supérieur.
2. Le cœur Python/MCP `voice-calibration-mcp` installé et disponible dans le
   `PATH` du processus local.
3. Une clé `ELEVENLABS_API_KEY` dans le `.env` déjà utilisé par le projet.
4. Une version active du corpus standard.

Lancer l’interface depuis le projet :

```bash
voice-calibration --open
```

Par défaut, le serveur écoute uniquement sur `127.0.0.1`. Un hôte non local
nécessite l’option explicite `--allow-network`.

La clé reste dans le backend. Elle n’est jamais injectée dans le navigateur,
dans les paramètres de calibration, dans les rapports ou dans les réponses
JSON de l’API locale.

## Parcours utilisateur

### 1. Accueil / configuration

L’écran indique si la clé ElevenLabs est configurée côté backend. Il ne montre
jamais sa valeur.

### 2. Corpus

L’interface affiche la version publiée active et ses textes dans l’ordre
canonique. Cette vue est en lecture seule : le texte envoyé pour une
calibration ne peut pas être modifié depuis ce parcours.

Une calibration utilise tout le corpus publié, sérialisé dans un seul texte,
avec les éléments séparés dans leur ordre publié. Une modification du corpus
doit produire une nouvelle version publiée avant de pouvoir servir à une
nouvelle calibration.

### 3. Préparer

L’utilisateur fournit uniquement l’**ID de voix ElevenLabs**. L’ID est la
référence stable utilisée pour reconnaître la voix et éviter de confondre deux
calibrations.

Le nom lisible de la voix est récupéré ensuite par le backend depuis ElevenLabs
et affiché dans le résultat. Il ne remplace pas l’ID.

Les paramètres techniques ne sont pas éditables dans l’UI : ils sont fixés par
le protocole standard du MVP.

### 4. Simulation (dry-run)

Le bouton **Préparer la simulation** demande au backend de :

- vérifier la configuration et la présence du corpus publié ;
- récupérer le schéma réel du cœur de calibration ;
- construire la requête complète à partir du corpus actif ;
- appliquer les valeurs nécessaires et `postproc="cut"` ;
- calculer l’empreinte de la requête ;
- demander au cœur une proposition de dry-run ;
- enregistrer le run uniquement si la proposition est acceptée.

Le dry-run ne génère aucun audio et n’exécute pas ElevenLabs pour la
synthèse. L’interface montre uniquement un récapitulatif humain : nombre de
requêtes, caractères facturables et coût estimé. Le JSON brut n’est pas affiché
dans l’interface.

### 5. Approbation et calibrage réel

L’utilisateur clique d’abord sur **Approuver la simulation**, puis sur
**Lancer le calibrage réel**. Ces deux actions sont distinctes pour rendre
visible le passage de la simulation à l’opération facturable.

L’approbation est liée à l’empreinte du snapshot préparé et expire après
15 minutes. Le run réel réutilise ce snapshot ; il ne reconstruit pas une
nouvelle requête à partir d’un état qui aurait changé entre-temps.

Un double clic ou une nouvelle tentative ne doit pas créer une deuxième
exécution du même run. Si la réponse du provider est perdue après émission,
le run passe à `execution_unknown` et aucun retry automatique n’est effectué.

### 6. Résultat

Après succès, l’onglet **Résultat** affiche :

- le statut du calibrage ;
- l’ID de voix ;
- le nom retourné par ElevenLabs ;
- le nombre d’audios synthétisés et en échec ;
- le WPM médian, minimum, maximum et la dispersion ;
- les crédits utilisés et le coût estimé quand ils sont disponibles.

Les métriques sont lues depuis le rapport du cœur. Le frontend ne recalcule
pas le WPM. Les données plus techniques restent repliées ou côté backend.

Si le nom ne peut pas être récupéré, le résultat reste consultable et indique
que le nom est indisponible pour cet ID. Cela ne transforme pas une calibration
réussie en nouvelle calibration.

### 7. Publication du profil WPM

Après un résultat réussi, cliquer sur **Rendre la voix disponible dans les
projets** :

1. le backend relit le rapport réussi ;
2. la source Python canonique vérifie le WPM et son contexte ;
3. une projection locale traçable du profil est enregistrée ;
4. l’interface confirme que la voix est disponible dans les projets.

Cette action est séparée du calibrage. Elle ne génère pas d’audio et n’appelle
pas ElevenLabs. Si la source canonique ne peut pas confirmer le WPM, la
publication échoue sans créer de profil local trompeur.

## États d’un run

```text
draft → dry_run_ready → approved → running → succeeded
                                      ├──────→ failed
                                      └──────→ execution_unknown
```

`execution_unknown` signifie que le système ne connaît pas l’issue réelle de
l’appel émis. Ce n’est pas un échec ordinaire et ce n’est pas une permission
de relancer à l’aveugle.

## Garanties du MVP

- **Corpus standard :** une calibration ne peut utiliser qu’une version
  publiée et figée.
- **Snapshot :** corpus, paramètres, modèle, post-traitement et digests sont
  conservés dans la requête résolue du run.
- **Approbation :** l’exécution réelle exige une approbation explicite,
  fraîche et cohérente avec le snapshot.
- **Idempotence locale :** un run possède un identifiant et une clé
  d’idempotence ; les états terminaux interdisent une seconde exécution.
- **Secrets :** la clé est résolue par le backend et transmise uniquement au
  processus/provider côté serveur.
- **Sécurité HTTP :** origine contrôlée, nonce de session pour les mutations,
  écoute loopback par défaut, réponses sans secret et protections de chemins.
- **Publication fail-closed :** un résultat non confirmé par la source WPM
  canonique ne devient pas un profil exploitable.

## Ce que le MVP ne fait pas

- calibrer Eleven v3 ou ajouter des balises émotionnelles au corpus ;
- permettre à l’utilisateur de modifier le corpus standard dans cette UI ;
- exposer les réglages techniques ElevenLabs ;
- afficher ou faire éditer la clé API dans le navigateur ;
- recalculer les métriques dans le frontend ;
- publier automatiquement le profil après le run ;
- fournir des comptes, rôles, quotas, facturation ou workers distants.

## Vérification locale

Depuis le projet :

```bash
npm run build
npm run typecheck
npm test
npm run lint
```

Les tests spécifiques au parcours sont dans `test/calibration-*.test.mjs`.
