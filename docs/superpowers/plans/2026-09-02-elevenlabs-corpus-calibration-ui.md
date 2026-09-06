# ElevenLabs Corpus Calibration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une web app locale qui crée un corpus canonique versionné, exécute une calibration ElevenLabs unique via le cœur existant et publie explicitement le WPM dans un profil de voix, avec une API déjà compatible avec une migration SaaS.

**Architecture:** Le navigateur appelle une API `/api/v1` servie par un backend Node local. Les services d’application possèdent le workflow corpus → dry-run → approbation → exécution → rapport → profil, mais délèguent les paramètres, validations et métriques à `run_calibration` et aux contrats MCP. Un `CalibrationBridge` isole le transport réel Node/TypeScript ↔ Python de `voice-calibration/`; les repositories et le fournisseur de credentials sont remplaçables par des implémentations SaaS.

**Tech Stack:** TypeScript strict compilé par `tsc`, serveur `node:http`, client HTML/TypeScript sans framework, `node:test`, fichiers JSON atomiquement écrits en local, aucun runtime dependency ajouté.

**Spec:** `docs/superpowers/specs/2026-09-02-elevenlabs-corpus-calibration-ui-design.md`

## Global Constraints

- La gate d’inventaire de `voice-calibration/` et des contrats MCP est bloquante avant tout type provider-specific ou toute route de calibration.
- La source à inventorier est `Shared/voice-calibration/` dans le vault ; son `README.md`, le serveur MCP câblé dans `Shared/.mcp.json` et le skill `calibrate-voice` décrivent le contrat effectif.
- Le transport Node ↔ Python est encapsulé dans `CalibrationBridge`; l’UI ne connaît ni MCP, ni Python, ni ElevenLabs.
- Le corpus canonique est unique, utilisé en entier et versionné par snapshots immuables ; une seule version publiée est active.
- `run_calibration` et les contrats MCP restent la source de vérité des paramètres, défauts, validations, dry-run et métriques.
- Le MCP actuel expose `calibrate_voice`, qui délègue à `core.calibration.run_calibration`; le parcours WPM utilise `mode = "precision"` et conserve `precision_stats` comme résultat source.
- Le parcours WPM MVP utilise le mode de calibration qui retourne directement les statistiques WPM (`mode = "precision"` dans le contrat actuel) ; le mode batterie, qui ne retourne pas de WPM agrégé, est hors périmètre.
- Le contrat actuel accepte un seul `text_source` ; le backend sérialise donc tous les items ordonnés de la `CorpusVersion` active en un texte `inline` stable, séparé par `\n\n`, avant résolution de la requête. Le corpus doit rester sous la limite de caractères du modèle ; aucun découpage en plusieurs requêtes n’est ajouté au MVP.
- `corpus_key` désigne l’alias du bucket Python `voice_wpm.json` et ne doit jamais être confondu avec l’identifiant local `CorpusVersion.id`. Par défaut, il vaut `voiceRef` ; `corpusVersionId` reste une métadonnée locale de snapshot et d’empreinte.
- `postproc` est transmis explicitement dans chaque requête de calibration.
- Le dry-run est obligatoire ; l’exécution réelle exige une approbation explicite liée au snapshot approuvé.
- **SaaS hardening — obligatoire avant mise en production :** tout appel provider susceptible d’entraîner un coût ElevenLabs doit obligatoirement traverser l’`Approval/Execution Gate`, quel que soit le point d’entrée (UI, API, CLI, worker ou automation). Aucun chemin direct vers l’adaptateur ElevenLabs ne doit être exposé aux couches applicatives ; la gate est la seule voie autorisée.
- L’empreinte SHA-256 inclut le digest du contrat, le digest du cœur, le corpus, la voix, tous les paramètres et `postproc`.
- Un timeout après émission d’une requête passe en `execution_unknown` et ne déclenche pas de retry automatique.
- `run_id` et la clé d’idempotence sont conservés pour toute reprise autorisée ; un nouveau run est une action explicite.
- Le rapport est immuable et ne publie jamais automatiquement un profil. Le WPM canonique est écrit et validé par Python dans `voice_wpm`/`Shared/voice-calibration/voice_wpm.json`, seule source consommée par les gates de durée ; Node ne possède ni n’écrit une autorité WPM concurrente.
- Le `VoiceProfile` local Node est uniquement une projection traçable pour l’affichage et l’historique. Son `wpmSnapshot` ne remplace jamais le record Python canonique et ne doit jamais être lu par les gates de durée.
- La clé locale est lue côté backend depuis `.env`, ne passe jamais au navigateur et n’apparaît ni dans les logs ni dans les artefacts.
- L’API et l’UI locales sont same-origin, liées à `127.0.0.1` par défaut, sans CORS large et avec nonce de session sur les mutations.
- L’approbation expire par défaut après 15 minutes, valeur calculée par le backend et affichée dans le dry-run ; l’exécution consomme l’approbation une seule fois.
- Un bind `--host` autre que `127.0.0.1`/`localhost` est refusé sauf présence d’un flag explicite `--allow-network` ; ce mode n’est pas activé par le MVP.
- Le client navigateur ne contient aucun import runtime ; les imports TypeScript éventuels sont `import type` et doivent disparaître du JavaScript compilé.
- Le stockage local utilise `workspace_id = local-default`, une révision/ETag simple et aucune infrastructure distribuée.
- Le build conserve Node >= 18, zéro dépendance runtime et les modifications non liées déjà présentes dans le worktree.

## File Map

Files created by the plan:

- `docs/elevenlabs-calibration-contract-inventory.md` — inventaire versionné de la source Python, du contrat MCP et du transport réellement sélectionné.
- `src/calibration/domain.ts` — modèles agnostiques du corpus, des runs, des rapports et des profils ; transitions d’état.
- `src/calibration/fingerprint.ts` — canonisation et empreinte déterministes de la requête approuvable.
- `src/calibration/ports.ts` — interfaces des repositories, du runner, du bridge, des credentials et des artefacts.
- `src/calibration/local-store.ts` — implémentations JSON locales, révisions et écritures atomiques.
- `src/calibration/bridge.ts` — adaptation du transport Node ↔ Python déterminé par l’inventaire.
- `src/calibration/credentials.ts` — statut et résolution server-side de la clé `.env`.
- `src/calibration/application.ts` — orchestration des cas d’usage sans logique de calibration.
- `src/calibration/http-server.ts` — serveur same-origin, routes `/api/v1`, nonce et fichiers statiques.
- `src/commands/calibration-ui.ts` — commande CLI de démarrage du serveur local.
- `src/ui/calibration-template.html` — shell de l’application web.
- `src/ui/calibration-client.ts` — rendu des écrans et appels à l’API, sans calcul métier.
- `scripts/build-calibration-ui.mjs` — copie/validation de l’UI dans `dist/ui`.

Files modified by the plan:

- `src/index.ts` — dispatch et aide de `calibration-ui`.
- `src/commands/ui.ts` — extraction éventuelle du helper d’ouverture de navigateur réutilisé par la nouvelle commande.
- `package.json` — ajout du build de l’UI calibration, sans nouvelle dépendance.
- `README.md` — commande de lancement local et règles BYOK/dry-run.

Tests created by the plan:

- `test/calibration-domain.test.mjs`
- `test/calibration-storage.test.mjs`
- `test/calibration-bridge.test.mjs`
- `test/calibration-api.test.mjs`
- `test/calibration-ui-html.test.mjs`
- `test/calibration-e2e.test.mjs`

## Task 1: Contract and Node–Python Bridge Inventory Gate

**Files:**
- Create: `docs/elevenlabs-calibration-contract-inventory.md`
- Read-only source: `Shared/voice-calibration/` in the vault, its authoritative `README.md`, the MCP wiring in `Shared/.mcp.json` and the `calibrate-voice` skill

**Interfaces:**
- Consumes: the actual Python source, its package metadata, its MCP definitions and its existing `.env` loading convention.
- Produces: a committed inventory containing the source revision, entrypoint, transport, framing, schema, defaults, dry-run semantics, result shape, error mapping, timeout behavior and idempotency guarantee. Tasks 2–7 must use this inventory and must not invent a provider field.

- [ ] **Step 1: Locate and fingerprint the source checkout**

  Resolve `Shared/voice-calibration/` from the vault root. Record in the inventory the repository/package identifier and the output of `git rev-parse HEAD` run from that checkout when it is a Git repository. Confirm the `Shared/.mcp.json` entry that wires the `voice-calibration` server and the command/environment it uses. If the source checkout or its MCP wiring is not available, stop the implementation sequence at this task and request it; do not create a replacement implementation in `capcut-cli-david`.

- [ ] **Step 2: Record the callable contract**

  Read the source definitions and record the exact `core.calibration.run_calibration` entrypoint and MCP tool `calibrate_voice`, including input fields `voice`, `model_id`, `voice_settings`, `text_source`, `mode`, `language`, `runs`, `corpus_key`/`voice_id`, `postproc` and `dry_run` as applicable. Record required fields, optional fields, default ownership, dry-run operation, `voice_resolution`, cost fields, success result, WPM location, error result and artifact references. The WPM-producing MVP path must use `mode = "precision"`; record how the canonical Python `voice_wpm` profile/table is updated or read after success. Include a compact JSON example copied from the actual schema, with credentials removed.

- [ ] **Step 3: Decide and document the bridge transport from evidence**

  Record exactly one transport selected from the `Shared/.mcp.json` wiring: expected current path is an MCP server over stdio, but the inventory must confirm the launch command and protocol rather than assume it. Document process lifecycle, message framing, stderr/exit-code behavior, cancellation, timeout boundary, Python executable/environment resolution and whether the runner/provider guarantees idempotency. Document the canonical write/read path for the WPM source. The later `CalibrationBridge` must implement this documented protocol rather than guessing from the UI.

- [ ] **Step 4: Verify the inventory is sufficient**

  Review the inventory against this checklist: an engineer can construct one `calibrate_voice` dry-run request in precision mode, display `billable_characters` and `estimated_cost_usd`, distinguish a provider rejection from a lost response, locate `precision_stats` WPM, update or verify the canonical Python profile/table, redact credentials and decide whether a timed-out execution is retryable. Expected: every item has a source citation and no unresolved marker or invented field remains.

- [ ] **Step 5: Commit the gate artifact**

  ```bash
  git add docs/elevenlabs-calibration-contract-inventory.md
  git commit -m "docs: inventory ElevenLabs calibration contract"
  ```

  Expected: only the inventory is staged; existing user changes remain unstaged and untouched.

## Task 2: Domain Models, State Machine and Request Fingerprint

**Files:**
- Create: `src/calibration/domain.ts`
- Create: `src/calibration/fingerprint.ts`
- Test: `test/calibration-domain.test.mjs`

**Interfaces:**
- Consumes: `docs/elevenlabs-calibration-contract-inventory.md` only for opaque contract/core digests and the result envelope; no provider-specific field is copied into the domain model.
- Produces: `RunStatus`, `CorpusItem`, `CorpusDraft`, `CorpusVersion`, `CalibrationRun`, `CalibrationReport`, `VoiceProfile`, `ResolvedCalibrationRequest`, `canonicalizeRequest()`, `fingerprintRequest()` and `transitionRun()`. Tasks 3–6 consume these names.

`VoiceProfile` is a local projection, not the WPM source of truth. Its
`wpmSnapshot` is historical display data; `canonicalRef` points to the Python
`voice_wpm` record/table that project duration gates consume. `publishProfile()`
must not report success until the canonical write/update or registration path
identified by Task 1 has succeeded. If the source exposes no supported write
path, the implementation must keep the profile unpublished and report the
missing integration instead of creating a competing local WPM authority.

- [ ] **Step 1: Write the failing domain tests**

  Add tests for the invariants below:

  ```js
  import { test } from "node:test";
  import { deepStrictEqual, match, strictEqual, throws } from "node:assert";
  import { fingerprintRequest, canonicalizeRequest } from "../dist/calibration/fingerprint.js";
  import { transitionRun } from "../dist/calibration/domain.js";

  const request = {
    contractDigest: "contract-sha",
    coreDigest: "core-sha",
    corpusVersionId: "standard-v1",
    corpusDigest: "corpus-sha",
    voiceRef: "voice-1",
    params: {
      model_id: "eleven_v3",
      voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
      text_source: { kind: "inline", text: "Bonjour le monde." },
      mode: "precision",
      language: "fr",
      runs: 3,
      dry_run: false,
      corpus_key: "voice-1",
    },
    postproc: "cut",
  };

  test("canonicalization is stable regardless of object key order", () => {
    strictEqual(
      canonicalizeRequest({
        ...request,
        params: {
          corpus_key: "voice-1",
          mode: "precision",
          text_source: { kind: "inline", text: "Bonjour le monde." },
          voice_settings: { use_speaker_boost: true, style: 0, similarity_boost: 0.85, stability: 0.5 },
          model_id: "eleven_v3",
          language: "fr",
          runs: 3,
          dry_run: false,
        },
      }),
      canonicalizeRequest(request),
    );
    match(fingerprintRequest(request), /^[a-f0-9]{64}$/);
  });

  test("changing corpus, parameter or postproc changes the fingerprint", () => {
    strictEqual(fingerprintRequest(request), fingerprintRequest({ ...request }));
    strictEqual(fingerprintRequest({ ...request, corpusDigest: "other" }) === fingerprintRequest(request), false);
    strictEqual(fingerprintRequest({ ...request, postproc: "trim" }) === fingerprintRequest(request), false);
  });

  test("illegal state transitions are rejected", () => {
    const draft = { status: "draft" };
    strictEqual(transitionRun(draft, { type: "dry_run_succeeded" }).status, "dry_run_ready");
    throws(() => transitionRun(draft, { type: "execute" }), /invalid transition/);
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `npm run build && node --test test/calibration-domain.test.mjs`

  Expected: FAIL because `dist/calibration/domain.js` and `dist/calibration/fingerprint.js` do not exist.

- [ ] **Step 3: Implement the domain types and transitions**

  Define these exact status values and interfaces:

  ```ts
  export type RunStatus =
    | "draft" | "dry_run_ready" | "approved" | "running"
    | "succeeded" | "failed" | "execution_unknown";

  export interface CorpusItem { id: string; order: number; text: string; }
  export interface CorpusDraft { workspaceId: string; revision: number; items: CorpusItem[]; }
  export interface CorpusVersion {
    id: string; workspaceId: string; revision: number; items: readonly CorpusItem[];
    contentDigest: string; status: "active" | "superseded"; publishedAt: string;
  }
  export interface ResolvedCalibrationRequest {
    contractDigest: string; coreDigest: string; corpusVersionId: string; corpusDigest: string;
    voiceRef: string; params: Record<string, unknown>; postproc: unknown;
  }
  export interface CalibrationRun {
    id: string; workspaceId: string; status: RunStatus; idempotencyKey: string;
    request: ResolvedCalibrationRequest; requestDigest: string;
    approval: { approvedAt: string; expiresAt: string; consumedAt: string | null } | null;
    reportId: string | null; createdAt: string; updatedAt: string;
  }
  export interface CalibrationReport {
    id: string; runId: string; request: ResolvedCalibrationRequest;
    requestDigest: string; metrics: Record<string, unknown>; artifacts: string[];
    providerResult: unknown; error: { code: string; message: string } | null;
    createdAt: string;
  }
  export interface VoiceProfile {
    id: string; workspaceId: string; voiceRef: string; wpmSnapshot: number;
    wpmAuthority: "python-voice-wpm"; canonicalRef: string;
    sourceRunId: string; corpusVersionId: string; reportId: string; publishedAt: string;
  }
  export type RunEvent =
    | { type: "dry_run_succeeded" }
    | { type: "approve"; expiresAt: string }
    | { type: "execute" }
    | { type: "succeeded" }
    | { type: "failed" }
    | { type: "execution_unknown" };
  ```

  `transitionRun()` must permit only the documented sequence, plus
  `running → execution_unknown`, `running → failed` and `running → succeeded`.
  It must reject execution from `draft`, `dry_run_ready`, `failed` or
  `execution_unknown`.

- [ ] **Step 4: Implement deterministic canonicalization and fingerprinting**

  `canonicalizeRequest()` must recursively sort object keys, preserve array
  order, encode `null` and booleans using JSON semantics, reject `undefined`
  values, and return UTF-8 JSON without whitespace. `fingerprintRequest()` must
  return `sha256(canonicalizeRequest(request))` as lowercase hexadecimal. No
  secret may be accepted in `ResolvedCalibrationRequest`.

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `npm run build && node --test test/calibration-domain.test.mjs`

  Expected: PASS.

- [ ] **Step 6: Commit the domain slice**

  ```bash
  git add src/calibration/domain.ts src/calibration/fingerprint.ts test/calibration-domain.test.mjs
  git commit -m "feat: add calibration domain and request fingerprint"
  ```

## Task 3: Local Repositories and Atomic Persistence

**Files:**
- Create: `src/calibration/ports.ts`
- Create: `src/calibration/local-store.ts`
- Test: `test/calibration-storage.test.mjs`

**Interfaces:**
- Consumes: domain types from Task 2 and `workspaceId = "local-default"`.
- Produces: `CorpusRepository`, `CalibrationRunRepository`, `VoiceProfileRepository`, `ArtifactStore` and `LocalStore`. Task 5 uses these interfaces without knowing the filesystem layout.

The test file defines `createLocalStore(dataDir: string): LocalStore` and a
valid `runFixture: CalibrationRun`; these are test helpers, not production
interfaces.

- [ ] **Step 1: Write failing repository tests**

  Cover the following concrete behavior:

  ```js
  import { mkdtempSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { deepStrictEqual, rejects, strictEqual } from "node:assert";
  import { createLocalStore } from "../dist/calibration/local-store.js";

  test("draft save uses revision and rejects stale writers", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "calibration-"));
    const store = createLocalStore(dataDir);
    const first = await store.corpus.getDraft("local-default");
    const saved = await store.corpus.saveDraft("local-default", { ...first, items: [{ id: "t1", order: 0, text: "Bonjour." }] }, first.revision);
    strictEqual(saved.revision, first.revision + 1);
    await rejects(
      store.corpus.saveDraft("local-default", { ...saved, items: [] }, first.revision),
      /revision conflict/,
    );
  });

  test("publishing creates an immutable active version", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "calibration-"));
    const store = createLocalStore(dataDir);
    const first = await store.corpus.getDraft("local-default");
    const saved = await store.corpus.saveDraft("local-default", { ...first, items: [{ id: "t1", order: 0, text: "Bonjour." }] }, first.revision);
    const version = await store.corpus.publishDraft("local-default", saved.revision);
    strictEqual(version.status, "active");
    const edited = await store.corpus.saveDraft("local-default", { ...saved, items: [{ id: "t1", order: 0, text: "Au revoir." }] }, saved.revision);
    strictEqual((await store.corpus.getActiveVersion("local-default")).items[0].text, "Bonjour.");
    strictEqual(edited.revision, saved.revision + 1);
  });

  test("writes survive reload and use the expected layout", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "calibration-"));
    const store = createLocalStore(dataDir);
    await store.runs.save(runFixture);
    const reloaded = createLocalStore(dataDir);
    deepStrictEqual(await reloaded.runs.get(runFixture.id), runFixture);
  });
  ```

- [ ] **Step 2: Run the storage tests to verify they fail**

  Run: `npm run build && node --test test/calibration-storage.test.mjs`

  Expected: FAIL because the repository interfaces and local store do not exist.

- [ ] **Step 3: Define repository ports**

  Add these signatures to `src/calibration/ports.ts`:

  ```ts
  export interface CorpusRepository {
    getDraft(workspaceId: string): Promise<CorpusDraft>;
    saveDraft(workspaceId: string, draft: CorpusDraft, expectedRevision: number): Promise<CorpusDraft>;
    publishDraft(workspaceId: string, expectedRevision: number): Promise<CorpusVersion>;
    getActiveVersion(workspaceId: string): Promise<CorpusVersion | null>;
    listVersions(workspaceId: string): Promise<CorpusVersion[]>;
  }
  export interface CalibrationRunRepository {
    create(run: CalibrationRun): Promise<void>;
    get(id: string): Promise<CalibrationRun | null>;
    save(run: CalibrationRun): Promise<void>;
  }
  export interface VoiceProfileRepository {
    list(workspaceId: string): Promise<VoiceProfile[]>;
    publish(profile: VoiceProfile): Promise<void>;
  }
  export interface ArtifactStore {
    put(runId: string, name: string, bytes: Uint8Array): Promise<string>;
    get(ref: string): Promise<Uint8Array>;
  }
  export interface LocalStore {
    corpus: CorpusRepository;
    runs: CalibrationRunRepository;
    profiles: VoiceProfileRepository;
    artifacts: ArtifactStore;
  }
  export function createLocalStore(dataDir: string): LocalStore;
  export class ConflictError extends Error {}
  ```

- [ ] **Step 4: Implement the filesystem layout and atomic writes**

  Use a configurable data directory. When `--data-dir` is omitted, use
  `path.join(os.homedir(), ".capcut-david", "elevenlabs-calibration")`.
  Store data under `workspaces/local-default/corpus/draft.json`,
  `corpus/versions/<version-id>.json`, `runs/<run-id>.json`,
  `profiles/<profile-id>.json` and `artifacts/<run-id>/<name>`.

  Write JSON to a sibling temporary file, flush and rename it into place. Keep
  published versions immutable. `publishDraft()` must write the new version and
  update the active pointer in one serialized operation. A stale revision throws
  `ConflictError` before any file is changed.

- [ ] **Step 5: Run the storage tests to verify they pass**

  Run: `npm run build && node --test test/calibration-storage.test.mjs`

  Expected: PASS.

- [ ] **Step 6: Commit the persistence slice**

  ```bash
  git add src/calibration/ports.ts src/calibration/local-store.ts test/calibration-storage.test.mjs
  git commit -m "feat: persist calibration corpus and results locally"
  ```

## Task 4: Credentials and Node–Python Calibration Bridge

**Files:**
- Create: `src/calibration/bridge.ts`
- Create: `src/calibration/credentials.ts`
- Test: `test/calibration-bridge.test.mjs`

**Interfaces:**
- Consumes: the exact transport and result semantics in `docs/elevenlabs-calibration-contract-inventory.md`.
- Produces: `CalibrationBridge`, `CanonicalProfilePort`, `CredentialProvider`, `DryRunResult`, `ExecutionResult` and `ConfigStatus`. Task 5 calls these interfaces and never spawns Python or reads `.env` itself.

The test file defines `resolvedRequest` with the Task 2 shape,
`fakeTransport(options)`, `makeBridge(options)` and
`makeCredentialProvider(env)`, plus `makeCanonicalProfilePort(result)`. These
helpers isolate the tests from a real Python process and a real ElevenLabs
account while verifying the canonical WPM write/read boundary.

- [ ] **Step 1: Write failing bridge tests with a fake transport**

  The fake transport must prove the bridge behavior without a real ElevenLabs
  call: it returns the inventory’s schema, records one dry-run request, returns
  a successful WPM result, emits stderr containing a fake secret, and can drop
  the response after acknowledging request emission.

  ```js
  import { assert, deepStrictEqual } from "node:assert";

  test("bridge forwards schema and dry-run without exposing credentials", async () => {
    const transport = fakeTransport({ dryRun: { accepted: true, plan: [] } });
    const bridge = makeBridge({ transport, credentials: { apiKey: "secret" } });
    deepStrictEqual(await bridge.getSchema(), transport.schema);
    await bridge.dryRun({ runId: "r1", request: resolvedRequest });
    assert.equal(JSON.stringify(transport.calls).includes("secret"), false);
  });

  test("lost execution response becomes execution_unknown", async () => {
    const bridge = makeBridge({ transport: fakeTransport({ dropExecutionResponse: true }) });
    await assert.rejects(bridge.execute({ runId: "r1", idempotencyKey: "r1", snapshot: resolvedRequest }), /execution_unknown/);
  });

  test("credential status never returns the key", async () => {
    const provider = makeCredentialProvider({ ELEVENLABS_API_KEY: "secret" });
    deepStrictEqual(await provider.status(), { configured: true });
    assert.equal(JSON.stringify(await provider.status()).includes("secret"), false);
  });

  test("profile publication delegates to the canonical Python WPM source", async () => {
    const canonical = makeCanonicalProfilePort({ canonicalRef: "Shared/voice-calibration/voice_wpm.json#voice-1.wpm_calibrated" });
    deepStrictEqual(await canonical.ensurePublished({ voiceRef: "voice-1", wpm: 148, runId: "r1", corpusVersionId: "standard-v1" }), { canonicalRef: "Shared/voice-calibration/voice_wpm.json#voice-1.wpm_calibrated" });
  });
  ```

- [ ] **Step 2: Run the bridge tests to verify they fail**

  Run: `npm run build && node --test test/calibration-bridge.test.mjs`

  Expected: FAIL because `CalibrationBridge` and `CredentialProvider` do not exist.

- [ ] **Step 3: Define the bridge ports**

  Use these contract-agnostic signatures; map their payloads to the actual
  inventory-defined schema inside the bridge adapter:

  ```ts
  export interface CredentialProvider {
    status(): Promise<ConfigStatus>;
    forRun(): Promise<{ provider: string; secret: string }>;
  }
  export interface ConfigStatus { configured: boolean; }
  export interface DryRunResult {
    accepted: boolean;
    plan: unknown[];
    raw: unknown;
  }
  export interface ExecutionResult {
    status: "succeeded" | "failed" | "unknown";
    metrics: Record<string, unknown>;
    artifacts: string[];
    raw: unknown;
    error?: { code: string; message: string };
  }
  export interface CanonicalProfilePort {
    ensurePublished(input: { voiceRef: string; wpm: number; runId: string; corpusVersionId: string }): Promise<{ canonicalRef: string }>;
  }
  export interface CalibrationBridge {
    getSchema(): Promise<unknown>;
    dryRun(input: { runId: string; request: ResolvedCalibrationRequest }): Promise<DryRunResult>;
    execute(input: { runId: string; idempotencyKey: string; snapshot: ResolvedCalibrationRequest }): Promise<ExecutionResult>;
    reconcile(input: { runId: string; idempotencyKey: string }): Promise<ExecutionResult | { status: "unknown" }>;
  }
  ```

  `forRun()` is backend-only and must never be serialized into an HTTP response
  or passed as a command-line argument. `DryRunResult` and `ExecutionResult`
  preserve the source result envelope, WPM and artifact references without
  recomputing metrics.

- [ ] **Step 4: Implement the transport selected by Task 1**

  If the inventory selects MCP stdio, keep one child-process session per bridge
  instance, implement the documented framing exactly, correlate responses by
  request id and close the process on server shutdown. If it selects direct
  subprocess or HTTP, implement that exact protocol instead. In all cases:

  - inject the secret through the source-supported environment/config channel;
  - redact the secret recursively from stderr and error objects;
  - distinguish pre-send failure from post-send lost response;
  - map post-send timeout to an `execution_unknown` error/state;
  - do not automatically replay a request after `execution_unknown`;
  - reuse the same idempotency key only when the inventory explicitly permits
    reconciliation.

  `CanonicalProfilePort.ensurePublished()` must use the canonical Python path
  recorded in Task 1. If the real calibration already updates `voice_wpm`, it
  verifies that record and returns its canonical reference. If the source
  exposes an explicit publish/update operation, it invokes that operation
  through the bridge. If neither path exists, it returns a structured
  integration error and the application must not create a local profile that
  pretends to be the production WPM source. The deprecated calibration scripts
  are never invoked directly.

- [ ] **Step 5: Implement `.env` resolution and safe configuration status**

  Reuse the `.env` convention recorded in the inventory. If the source relies
  on a loader not available to the Node process, add a minimal Node-standard
  parser for the single required key, preserving quoted values and ignoring
  comments. Never log the parsed value. A missing key yields
  `{ configured: false }` and prevents dry-run/execute calls.

- [ ] **Step 6: Run bridge tests and commit**

  Run: `npm run build && node --test test/calibration-bridge.test.mjs`

  Expected: PASS with the fake transport and no secret in test output.

  ```bash
  git add src/calibration/bridge.ts src/calibration/credentials.ts test/calibration-bridge.test.mjs
  git commit -m "feat: bridge Node calibration API to Python core"
  ```

## Task 5: Application Service, Safe State Transitions and Local HTTP API

**Files:**
- Create: `src/calibration/application.ts`
- Create: `src/calibration/http-server.ts`
- Create: `src/commands/calibration-ui.ts`
- Modify: `src/index.ts`
- Modify: `src/commands/ui.ts`
- Test: `test/calibration-api.test.mjs`

**Interfaces:**
- Consumes: repositories from Task 3, `CalibrationBridge`/`CanonicalProfilePort`/`CredentialProvider` from Task 4 and domain/fingerprint functions from Task 2.
- Produces: `CalibrationApplication`, API routes under `/api/v1`, `startCalibrationUi()` and the CLI command `capcut-david calibration-ui [--data-dir <dir>] [--host <host>] [--port <port>] [--open] [--allow-network]`.

The test file defines `memoryRepositories()`, `fakeBridge()`,
`fakeCanonicalProfilePort()` and
`makeApplication({ repositories, bridge, canonical, clock })`; each helper returns the
exact Task 3/4 interface and is used only to avoid network and filesystem
effects in application tests.

Add an injectable application clock: `makeApplication({ repositories, bridge,
canonical, clock })` passes `clock` through to the application, while production
wiring supplies a `systemClock` implementation. Keep the port minimal:

```ts
export interface Clock {
  now(): Date;
}
```

Tests must use a fake clock and must never monkey-patch `Date` or wait in real
time.

The test-only `RepositoryBundle` is
`{ corpus: CorpusRepository; runs: CalibrationRunRepository; profiles: VoiceProfileRepository; artifacts: ArtifactStore }`.

Define these application DTOs in `src/calibration/application.ts`:

```ts
export interface CalibrationInput {
  workspaceId: string;
  voiceRef: string;
  params: Record<string, unknown>;
  postproc: unknown;
}
export interface BootstrapView {
  sessionNonce: string;
  config: { configured: boolean };
  activeCorpus: CorpusVersion | null;
  profiles: VoiceProfile[];
  recentRuns: CalibrationRun[];
}
export interface CorpusView {
  draft: CorpusDraft;
  activeVersion: CorpusVersion | null;
  versions: CorpusVersion[];
}
```

- [ ] **Step 1: Write failing application tests for the full state workflow**

  Use in-memory repositories and a fake bridge. Assert that the service:

  1. refuses calibration without an active published corpus;
  2. creates a run from the complete schema-resolved request;
  3. stores `dry_run_ready` with request digest;
  4. approves only the exact digest and stores `expiresAt`;
  5. atomically consumes approval before execution;
  6. persists a report without creating a profile;
  7. publishes a profile only from a successful report with WPM;
  8. maps a lost response to `execution_unknown` without a retry;
  9. rejects approval after the 15-minute TTL using the injected clock:

     ```js
     let now = new Date("2026-09-02T10:00:00Z");
     const clock = { now: () => now };
     const repositories = memoryRepositories();
     const app = makeApplication({ repositories, bridge: fakeBridge(), canonical: fakeCanonicalProfilePort(), clock });
     const run = await app.prepareDryRun(input);
     await app.approve(run.id, { requestDigest: run.requestDigest });
     now = new Date("2026-09-02T10:16:00Z");
     await assert.rejects(app.execute(run.id), /approval expired/);
     ```

  ```js
  import { assert, strictEqual } from "node:assert";

  test("execute requires the still-valid approved snapshot", async () => {
    const app = makeApplication({ repositories: memoryRepositories(), bridge: fakeBridge(), canonical: fakeCanonicalProfilePort() });
    const run = await app.prepareDryRun({
      workspaceId: "local-default",
      voiceRef: "voice-1",
      params: {
        model_id: "eleven_v3",
        voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
        text_source: { kind: "inline", text: "Bonjour le monde." },
        mode: "precision",
        language: "fr",
        runs: 3,
        dry_run: false,
        corpus_key: "voice-1",
      },
      postproc: "cut",
    });
    await assert.rejects(app.execute(run.id), /approval required/);
    await app.approve(run.id, { requestDigest: run.requestDigest });
    const result = await app.execute(run.id);
    strictEqual(result.status, "succeeded");
    strictEqual((await app.listVoiceProfiles()).length, 0);
    await app.publishProfile(run.id);
    strictEqual((await app.listVoiceProfiles()).length, 1);
  });
  ```

- [ ] **Step 2: Run the application test to verify it fails**

  Run: `npm run build && node --test test/calibration-api.test.mjs`

  Expected: FAIL because the application service and API server do not exist.

- [ ] **Step 3: Implement application use cases**

  Add these methods to `CalibrationApplication`:

  ```ts
  getBootstrap(workspaceId: string): Promise<BootstrapView>;
  getCorpus(workspaceId: string): Promise<CorpusView>;
  getDraft(workspaceId: string): Promise<{ draft: CorpusDraft; etag: string }>;
  saveDraft(workspaceId: string, draft: CorpusDraft, expectedRevision: number): Promise<CorpusDraft>;
  publishCorpusVersion(workspaceId: string, expectedRevision: number): Promise<CorpusVersion>;
  getCalibrationSchema(): Promise<unknown>;
  prepareDryRun(input: CalibrationInput): Promise<CalibrationRun>;
  approve(runId: string, input: { requestDigest: string }): Promise<CalibrationRun>;
  execute(runId: string): Promise<CalibrationRun>;
  reconcile(runId: string): Promise<CalibrationRun>;
  getRun(runId: string): Promise<CalibrationRun | null>;
  publishProfile(runId: string): Promise<VoiceProfile>;
  listVoiceProfiles(workspaceId: string): Promise<VoiceProfile[]>;
  ```

  `prepareDryRun()` must obtain the active corpus, call the bridge schema,
  resolve defaults through the contract adapter, set explicit `postproc`,
  calculate the digest and persist the run only after dry-run succeeds.
  `approve()` compares the submitted digest with the stored digest. `execute()`
  checks the 15-minute expiry, current contract/core digests and state,
  atomically consumes approval, and executes the stored snapshot rather than
  rebuilding it. `publishProfile()` extracts WPM from the successful source
  result, calls `CanonicalProfilePort.ensurePublished()`, and stores the local
  projection only after the canonical Python source returns its reference.

- [ ] **Step 4: Implement the HTTP server and routes**

  Implement these routes with JSON responses:

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
  POST /api/v1/calibration-runs/:id/reconcile
  GET  /api/v1/calibration-runs/:id
  GET  /api/v1/voice-profiles
  POST /api/v1/voice-profiles
  ```

  Use `200` for reads/success, `201` for creation, `400` for malformed JSON,
  `409` for revision/state/approval conflicts, `412` for failed `If-Match`,
  `422` for contract validation, `503` for unavailable credentials/core and
  `500` only for an unexpected local failure. Redact errors before serializing.

  `GET /api/v1/bootstrap` creates/returns the process nonce once; the client
  keeps it in memory and sends it as `X-Calibration-Nonce` on mutations.
  `GET /api/v1/calibration/schema` exposes the actual `calibrate_voice` schema
  from the bridge. `GET /api/v1/corpus/draft` returns an `ETag` derived from the revision. `PUT` requires
  `If-Match`; a mismatch changes nothing. Mutations require the process nonce in
  `X-Calibration-Nonce`. Serve the HTML and API from the same origin, reject
  broad CORS, reject unknown static paths and prevent path traversal.

- [ ] **Step 5: Implement the CLI launcher**

  Add `calibration-ui` to `src/index.ts` before project-path handling. The
  command starts on `127.0.0.1` by default, accepts port `0` to select a free
  port, prints the final URL, and opens it only when `--open` is supplied. A
  non-loopback `--host` is rejected unless `--allow-network` is also present;
  the command documents that this opt-in exposes an unauthenticated local
  credential consumer. Reuse
  the existing platform-specific browser-opening helper from `src/commands/ui.ts`
  without changing the existing `ui` behavior.

- [ ] **Step 6: Run API tests and commit**

  Run: `npm run build && node --test test/calibration-api.test.mjs`

  Expected: PASS, including approval mismatch, expiry, nonce failure, ETag
  conflict, non-loopback host refusal and `execution_unknown` behavior.

  ```bash
  git add src/calibration/application.ts src/calibration/http-server.ts src/commands/calibration-ui.ts src/index.ts src/commands/ui.ts test/calibration-api.test.mjs
  git commit -m "feat: expose local calibration API and workflow"
  ```

## Task 6: Browser UI and Build Integration

**Files:**
- Create: `src/ui/calibration-template.html`
- Create: `src/ui/calibration-client.ts`
- Create: `scripts/build-calibration-ui.mjs`
- Modify: `package.json`
- Test: `test/calibration-ui-html.test.mjs`

**Interfaces:**
- Consumes: API routes from Task 5, especially the returned MCP schema, ETag, nonce and opaque run/report data.
- Produces: `dist/ui/calibration.html` and `dist/ui/calibration-client.js`, served by the local backend. No frontend metric, default, provider validation or state-machine implementation is produced.

`src/ui/calibration-client.ts` must have no runtime imports. Any shared TypeScript
shape is imported with `import type`, so `tsc` erases it. The browser bundle must
be self-contained and may call only relative `/api/v1` URLs.

- [ ] **Step 1: Write failing static UI/build tests**

  Assert that the built page exists, contains the five required views, references
  only same-origin assets, and contains no secret or unresolved template marker:

  ```js
  import { ok } from "node:assert";
  import { existsSync, readFileSync } from "node:fs";
  import { dirname, resolve } from "node:path";
  import { fileURLToPath } from "node:url";

  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  test("calibration UI is built and same-origin", () => {
    ok(existsSync(resolve(ROOT, "dist/ui/calibration.html")));
    const html = readFileSync(resolve(ROOT, "dist/ui/calibration.html"), "utf8");
    const client = readFileSync(resolve(ROOT, "dist/ui/calibration-client.js"), "utf8");
    for (const label of ["Corpus", "Préparer", "Dry-run", "Résultat", "Profils"]) ok(html.includes(label));
    ok(html.includes("/calibration-client.js"));
    ok(!/src=\"https?:|href=\"https?:|ELEVENLABS_API_KEY/.test(html));
    ok(!html.includes("/*__CALIBRATION_TEMPLATE__*/"));
    ok(!/^\s*(?:import|export)\b/m.test(client), "browser client must have no runtime module imports/exports");
    ok(!client.includes("import("), "browser client must not use dynamic imports");
  });
  ```

- [ ] **Step 2: Run the UI test to verify it fails**

  Run: `npm run build && node --test test/calibration-ui-html.test.mjs`

  Expected: FAIL because the calibration page and build script do not exist.

- [ ] **Step 3: Implement the template and client rendering**

  Create the five views: accueil/configuration, corpus, préparation, dry-run,
  résultat/profils. The client must:

  - fetch bootstrap and schema from the API;
  - render required/optional fields from the returned schema;
  - display `postproc` as an explicit field;
  - preserve the draft ETag on save and show a conflict instead of overwriting;
  - display the resolved request and digest returned by the backend;
  - enable approve only for a ready dry-run;
  - enable execute only for an approved run;
  - display WPM from the report without calculating it;
  - call profile publication only from its separate button;
  - keep the nonce in memory and send it only in mutation headers.

  The client may perform input formatting and empty-field affordances, but the
  backend remains authoritative for all validation and state transitions.

  Put the marker `/*__CALIBRATION_TEMPLATE__*/` in the template’s module
  script. The build step replaces it with a small `const BUILD = { version,
  builtAt }` literal; the client does not import package metadata at runtime.

- [ ] **Step 4: Implement build integration**

  `scripts/build-calibration-ui.mjs` must copy the template to
  `dist/ui/calibration.html`, verify its marker and verify that the compiled
  `dist/ui/calibration-client.js` exists. It must also read the compiled client
  and fail the build if it contains a static `import`/`export` declaration or a
  dynamic `import(`, preventing a browser 404 caused by a Node-relative module
  import. Extend `package.json`’s `build` script
  with `node scripts/build-calibration-ui.mjs` after `tsc` and before the final
  build assertions. Do not add a frontend package or a CDN asset.

- [ ] **Step 5: Run UI tests and commit**

  Run: `npm run build && node --test test/calibration-ui-html.test.mjs`

  Expected: PASS.

  ```bash
  git add src/ui/calibration-template.html src/ui/calibration-client.ts scripts/build-calibration-ui.mjs package.json test/calibration-ui-html.test.mjs
  git commit -m "feat: add local calibration browser UI"
  ```

## Task 7: End-to-End MVP Validation and Documentation

**Files:**
- Create: `test/calibration-e2e.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete local command, API, fake bridge and repositories from Tasks 2–6.
- Produces: a repeatable automated acceptance test and user-facing local setup instructions.

- [ ] **Step 1: Write the end-to-end acceptance test**

  Start the server against a temporary data directory with a fake bridge and
  call the API in this exact order:

  ```text
  bootstrap
  → read draft
  → PUT three standard texts with If-Match
  → publish corpus version
  → request schema
  → create dry-run with explicit postproc
  → approve returned digest
  → execute once
  → fetch report/WPM
  → verify/update canonical Python `voice_wpm` record
  → publish profile
  → execute the same run again and assert no second bridge call
  ```

  Also assert that changing the draft after dry-run does not alter the stored
  run, that an expired approval returns `409`, that a fake lost response yields
  `execution_unknown`, and that serialized responses/log captures contain no
  credential. Assert that profile publication fails closed when the canonical
  Python WPM port fails, and that a successful publication stores a
  `canonicalRef` in the local projection.

- [ ] **Step 2: Run the acceptance test to verify the first integration failure**

  Run: `npm run build && node --test test/calibration-e2e.test.mjs`

  Expected: the test runs against the assembled implementation; any failure is
  an integration defect to fix before documenting success.

- [ ] **Step 3: Add README usage documentation**

  Document the exact local flow:

  ```text
  ELEVENLABS_API_KEY=… in .env
  capcut-david calibration-ui --open
  ```

  Explain that the key stays server-side, the corpus must be published before
  calibration, `postproc` is explicit, dry-run approval is mandatory, and WPM
  becomes reusable only after the canonical Python profile/table is updated or
  verified. The existing `calibrate-voice` skill remains the manual/agent
  entrypoint and continues to call the same `calibrate_voice` MCP tool; the new
  UI is an additional client, not a replacement. Do not document provider
  fields until they appear in the committed contract inventory.

- [ ] **Step 4: Run the complete verification suite**

  Run:

  ```bash
  npm run build
  npm run typecheck
  npm test
  npm run lint
  node --test test/calibration-e2e.test.mjs
  git diff --check
  ```

  Expected: all commands pass; no secret appears in generated files; only the
  intended new/modified files are staged.

- [ ] **Step 5: Commit the MVP validation slice**

  ```bash
  git add README.md test/calibration-e2e.test.mjs
  git commit -m "docs: validate local ElevenLabs calibration MVP"
  ```

## SaaS hardening — obligatoire avant mise en production

Cette exigence s’applique à la migration SaaS et ne modifie pas le MVP local
ni l’architecture validée. Les points d’entrée supplémentaires peuvent
soumettre ou planifier une demande auprès du service d’application, mais aucun
d’entre eux ne peut appeler directement l’adaptateur ElevenLabs. Un worker ou
une automation n’exécute qu’un snapshot déjà approuvé par la gate.

**Invariant :** tout appel provider susceptible d’entraîner un coût ElevenLabs
doit obligatoirement traverser l’`Approval/Execution Gate`, quel que soit le
point d’entrée (UI, API, CLI, worker ou automation). Aucun chemin direct vers
l’adaptateur ElevenLabs ne doit être exposé aux couches applicatives. La gate
est la seule voie autorisée entre ces couches et l’adaptateur provider.

**Critère d’acceptation testable, préalable à la mise en production SaaS :**

- Le test utilise un provider et une gate espionnés, puis exerce chacun des
  chemins UI, API, CLI, worker et automation.
- Pour chaque chemin, une demande sans approbation valide est refusée et le
  compteur d’appels provider reste à zéro.
- Pour chaque chemin, un snapshot approuvé produit au plus un appel provider,
  et l’ordre observé est `Approval/Execution Gate` puis adaptateur ElevenLabs.
- Le test vérifie par inspection des exports/du graphe de dépendances que les
  couches applicatives n’exposent aucun accès direct à l’adaptateur ; la gate
  est la seule voie autorisée.

## Plan Self-Review

- **Spec coverage:** contract/bridge gate and canonical Python WPM ownership are
  Task 1; corpus immutability and projection profiles are Tasks 2–3; dry-run,
  approval, fingerprint and idempotence are Tasks 2, 4 and 5; API and UI are
  Tasks 5–6; security and nonce bootstrap are Task 5; browser module isolation
  is Task 6; acceptance and skill coexistence are Task 7; SaaS-compatible ports
  and workspace scope are Tasks 2–3; the pre-production SaaS hardening
  invariant and its five-entry-point acceptance test are specified explicitly
  in the dedicated hardening section.
- **Placeholder scan:** the plan contains no unresolved marker or invented
  provider field. The only source-dependent choice is intentionally confined to
  Task 1 and is recorded before any implementation task begins.
- **Type consistency:** Task 2 defines the domain names used by Tasks 3–5;
  Task 3 defines repository ports; Task 4 defines bridge/credential ports;
  Task 5 consumes those names; Task 6 consumes only Task 5 HTTP responses.
- **Scope check:** the plan does not include A/B testing, human reference audio,
  SaaS accounts, billing implementation, distributed jobs or a second scoring
  engine. Local SaaS seams are represented with minimal fixed values and
  replaceable ports.
