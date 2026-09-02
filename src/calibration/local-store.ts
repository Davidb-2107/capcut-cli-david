import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rename, access, lstat, rm, link } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

import type {
  CalibrationRun,
  CorpusDraft,
  CorpusItem,
  CorpusVersion,
  VoiceProfile,
} from "./domain.js";
import type {
  ArtifactStore,
  CalibrationRunRepository,
  CorpusRepository,
  LocalStore,
  VoiceProfileRepository,
} from "./ports.js";
import { ConflictError } from "./ports.js";

const DEFAULT_DATA_DIR = join(homedir(), ".capcut-david", "elevenlabs-calibration");
const corpusQueues = new Map<string, Promise<unknown>>();

function workspaceRoot(dataDir: string, workspaceId: string): string {
  return join(dataDir, "workspaces", safeSegment(workspaceId, "workspaceId"));
}

function safeSegment(value: string, label: string): string {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\")) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function safeArtifactPath(root: string, runId: string, name?: string): string {
  const artifactRoot = resolve(root, "artifacts");
  const runRoot = resolve(artifactRoot, safeSegment(runId, "runId"));
  if (name === undefined) return runRoot;
  if (!name || name.includes("\0")) throw new Error("invalid artifact path");

  const target = resolve(runRoot, name);
  if (target === runRoot || !target.startsWith(`${runRoot}${sep}`)) {
    throw new Error("invalid artifact path");
  }
  return target;
}

async function assertNoSymlinkWithin(root: string, target: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const relativeTarget = relative(resolvedRoot, resolvedTarget);
  if (relativeTarget.startsWith("..") || relativeTarget.split(sep).includes("..")) {
    throw new Error("invalid path boundary");
  }

  let current = resolvedTarget;
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("symbolic links are not allowed");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
        continue;
      }
      throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx");
  try {
    await handle.write(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, path);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const LOCK_WAIT_MS = 10;
const LOCK_TIMEOUT_MS = 30_000;
async function withFileLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
  const lockFile = `${lockPath}.lock`;
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    const tempLock = `${lockFile}.${process.pid}-${randomUUID()}.tmp`;
    let acquired = false;
    try {
      const handle = await open(tempLock, "wx");
      try {
        await handle.write(Buffer.from(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8"));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(tempLock, lockFile);
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await rm(tempLock, { force: true });
    }
    if (acquired) break;
    if (Date.now() >= deadline) {
      throw new Error("calibration store lock timeout; existing lock was not taken over");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, LOCK_WAIT_MS));
  }

  try {
    return await work();
  } finally {
    await rm(lockFile, { force: true });
  }
}

function itemsDigest(items: readonly CorpusItem[]): string {
  return createHash("sha256").update(JSON.stringify(items), "utf8").digest("hex");
}

function cloneDraft(draft: CorpusDraft): CorpusDraft {
  return {
    workspaceId: draft.workspaceId,
    revision: draft.revision,
    items: draft.items.map((item) => ({ ...item })),
  };
}

function cloneVersion(version: CorpusVersion): CorpusVersion {
  return { ...version, items: version.items.map((item) => ({ ...item })) };
}

function queueFor<T>(queues: Map<string, Promise<unknown>>, key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(key, next);
  return next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}

function makeCorpusRepository(dataDir: string): CorpusRepository {
  const draftPath = (workspaceId: string) => join(workspaceRoot(dataDir, workspaceId), "corpus", "draft.json");
  const versionsRoot = (workspaceId: string) => join(workspaceRoot(dataDir, workspaceId), "corpus", "versions");
  const activePath = (workspaceId: string) => join(workspaceRoot(dataDir, workspaceId), "corpus", "active.json");

  async function loadDraft(workspaceId: string): Promise<CorpusDraft> {
    const path = draftPath(workspaceId);
    if (!(await exists(path))) {
      return { workspaceId, revision: 0, items: [] };
    }
    return cloneDraft(await readJson<CorpusDraft>(path));
  }

  async function loadActiveId(workspaceId: string): Promise<string | null> {
    const path = activePath(workspaceId);
    if (!(await exists(path))) return null;
    return (await readJson<{ versionId: string }>(path)).versionId;
  }

  return {
    getDraft: loadDraft,

    saveDraft(workspaceId, draft, expectedRevision) {
      return queueFor(corpusQueues, `${resolve(dataDir)}:${workspaceId}`, () =>
        withFileLock(join(workspaceRoot(dataDir, workspaceId), "corpus", "draft.json"), async () => {
          const current = await loadDraft(workspaceId);
          if (current.revision !== expectedRevision) throw new ConflictError();
          if (draft.workspaceId !== workspaceId) throw new Error("draft workspace mismatch");
          const saved: CorpusDraft = {
            workspaceId,
            revision: current.revision + 1,
            items: draft.items.map((item) => ({ ...item })),
          };
          await writeJson(draftPath(workspaceId), saved);
          return cloneDraft(saved);
        }),
      );
    },

    publishDraft(workspaceId, expectedRevision) {
      return queueFor(corpusQueues, `${resolve(dataDir)}:${workspaceId}`, () =>
        withFileLock(join(workspaceRoot(dataDir, workspaceId), "corpus", "draft.json"), async () => {
          const draft = await loadDraft(workspaceId);
          if (draft.revision !== expectedRevision) throw new ConflictError();
          const publishedAt = new Date().toISOString();
          const version: CorpusVersion = {
            id: randomUUID(),
            workspaceId,
            revision: draft.revision,
            items: draft.items.map((item) => ({ ...item })),
            contentDigest: itemsDigest(draft.items),
            status: "active",
            publishedAt,
          };
          await writeJson(join(versionsRoot(workspaceId), `${version.id}.json`), version);
          await writeJson(activePath(workspaceId), { versionId: version.id });
          return cloneVersion(version);
        }),
      );
    },

    async getActiveVersion(workspaceId) {
      const versionId = await loadActiveId(workspaceId);
      if (!versionId) return null;
      const version = await readJson<CorpusVersion>(join(versionsRoot(workspaceId), `${safeSegment(versionId, "versionId")}.json`));
      return cloneVersion({ ...version, status: "active" });
    },

    async listVersions(workspaceId) {
      const root = versionsRoot(workspaceId);
      if (!(await exists(root))) return [];
      const activeId = await loadActiveId(workspaceId);
      const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
      const versions = await Promise.all(
        names.map(async (name) => {
          const version = await readJson<CorpusVersion>(join(root, name));
          return cloneVersion({ ...version, status: version.id === activeId ? "active" : "superseded" });
        }),
      );
      return versions;
    },
  };
}

function makeRunRepository(dataDir: string): CalibrationRunRepository {
  const pathFor = (id: string) => join(dataDir, "workspaces", "local-default", "runs", `${safeSegment(id, "runId")}.json`);
  return {
    async create(run) {
      const path = pathFor(run.id);
      if (await exists(path)) throw new ConflictError("run already exists");
      await writeJson(path, run);
    },
    async get(id) {
      const path = pathFor(id);
      return (await exists(path)) ? readJson<CalibrationRun>(path) : null;
    },
    async save(run) {
      await writeJson(pathFor(run.id), run);
    },
  };
}

function makeProfileRepository(dataDir: string): VoiceProfileRepository {
  const rootFor = (workspaceId: string) => join(workspaceRoot(dataDir, workspaceId), "profiles");
  return {
    async list(workspaceId) {
      const root = rootFor(workspaceId);
      if (!(await exists(root))) return [];
      const names = (await readdir(root)).filter((name) => name.endsWith(".json")).sort();
      return Promise.all(names.map((name) => readJson<VoiceProfile>(join(root, name))));
    },
    async publish(profile) {
      await writeJson(join(rootFor(profile.workspaceId), `${safeSegment(profile.id, "profileId")}.json`), profile);
    },
  };
}

function makeArtifactStore(dataDir: string): ArtifactStore {
  const artifactsRoot = resolve(dataDir, "workspaces", "local-default", "artifacts");
  return {
    async put(runId, name, bytes) {
      const target = safeArtifactPath(join(dataDir, "workspaces", "local-default"), runId, name);
      await assertNoSymlinkWithin(artifactsRoot, target);
      await writeAtomic(target, bytes);
      return relative(dataDir, target).split("\\").join("/");
    },
    async get(ref) {
      const target = resolve(dataDir, ref);
      if (target !== artifactsRoot && !target.startsWith(`${artifactsRoot}${sep}`)) {
        throw new Error("invalid artifact reference");
      }
      await assertNoSymlinkWithin(artifactsRoot, target);
      return new Uint8Array(await readFile(target));
    },
  };
}

export function createLocalStore(dataDir = DEFAULT_DATA_DIR): LocalStore {
  return {
    corpus: makeCorpusRepository(resolve(dataDir)),
    runs: makeRunRepository(resolve(dataDir)),
    profiles: makeProfileRepository(resolve(dataDir)),
    artifacts: makeArtifactStore(resolve(dataDir)),
  };
}
