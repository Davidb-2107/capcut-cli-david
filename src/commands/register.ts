import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { defaultProjectsRoot, nowUs } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";

// =============================================================
// CapCut indexes drafts by scanning <projects-root>/root_meta_info.json
// and reading the .all_draft_store[] array. A draft directory on disk is
// invisible to the CapCut UI unless an entry referencing it lives there.
// This command appends that entry; it's idempotent on draft_id.
// =============================================================

export interface RegisterOptions {
  draftDir: string;
  projectsRoot?: string;
}

export interface RegisterResult {
  draftId: string;
  draftName: string;
  rootMetaPath: string;
  added: boolean;
}

interface AllDraftStoreEntry {
  cloud_draft_cover: boolean;
  cloud_draft_sync: boolean;
  draft_cloud_last_action_download: boolean;
  draft_cloud_purchase_info: string;
  draft_cloud_template_id: string;
  draft_cloud_tutorial_info: string;
  draft_cloud_videocut_purchase_info: string;
  draft_cover: string;
  draft_fold_path: string;
  draft_id: string;
  draft_is_ai_shorts: boolean;
  draft_is_cloud_temp_draft: boolean;
  draft_is_invisible: boolean;
  draft_is_web_article_video: boolean;
  draft_json_file: string;
  draft_name: string;
  draft_new_version: string;
  draft_root_path: string;
  draft_timeline_materials_size: number;
  draft_type: string;
  draft_web_article_video_enter_from: string;
  streaming_edit_draft_ready: boolean;
  tm_draft_cloud_completed: string;
  tm_draft_cloud_entry_id: number;
  tm_draft_cloud_modified: number;
  tm_draft_cloud_parent_entry_id: number;
  tm_draft_cloud_space_id: number;
  tm_draft_cloud_user_id: number;
  tm_draft_create: number;
  tm_draft_modified: number;
  tm_draft_removed: number;
  tm_duration: number;
}

interface RootMetaInfo {
  all_draft_store: AllDraftStoreEntry[];
  draft_ids: string[];
  root_path: string;
}

function buildEntry(draftDir: string, meta: Record<string, unknown>, projectsRoot: string): AllDraftStoreEntry {
  const draftId = String(meta.draft_id);
  const tmCreate = typeof meta.tm_draft_create === "number" ? meta.tm_draft_create : nowUs();
  const tmModified = typeof meta.tm_draft_modified === "number" ? meta.tm_draft_modified : tmCreate;
  return {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    draft_cloud_last_action_download: false,
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: resolve(draftDir, "draft_cover.jpg"),
    draft_fold_path: typeof meta.draft_fold_path === "string" && meta.draft_fold_path ? meta.draft_fold_path : draftDir,
    draft_id: draftId,
    draft_is_ai_shorts: false,
    draft_is_cloud_temp_draft: false,
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_json_file: resolve(draftDir, "draft_content.json"),
    draft_name: String(meta.draft_name),
    draft_new_version: typeof meta.draft_new_version === "string" ? meta.draft_new_version : "164.0.0",
    draft_root_path:
      typeof meta.draft_root_path === "string" && meta.draft_root_path ? meta.draft_root_path : projectsRoot,
    draft_timeline_materials_size:
      typeof meta.draft_timeline_materials_size_ === "number" ? meta.draft_timeline_materials_size_ : 0,
    draft_type: typeof meta.draft_type === "string" ? meta.draft_type : "",
    draft_web_article_video_enter_from: "",
    streaming_edit_draft_ready: true,
    tm_draft_cloud_completed: "",
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_cloud_user_id: -1,
    tm_draft_create: tmCreate,
    tm_draft_modified: tmModified,
    tm_draft_removed: 0,
    tm_duration: typeof meta.tm_duration === "number" ? meta.tm_duration : 0,
  };
}

export function registerDraft(opts: RegisterOptions): RegisterResult {
  const draftDir = resolve(opts.draftDir);
  const metaPath = resolve(draftDir, "draft_meta_info.json");
  if (!existsSync(metaPath)) {
    die(
      `No draft_meta_info.json in ${draftDir}. Run psycho-build (or another draft generator) first, or pass a valid draft directory.`,
    );
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;

  const projectsRoot = resolve(opts.projectsRoot ?? defaultProjectsRoot());
  if (!existsSync(projectsRoot)) mkdirSync(projectsRoot, { recursive: true });
  const rootMetaPath = resolve(projectsRoot, "root_meta_info.json");

  let root: RootMetaInfo;
  if (existsSync(rootMetaPath)) {
    const parsed = JSON.parse(readFileSync(rootMetaPath, "utf-8")) as Partial<RootMetaInfo>;
    root = {
      all_draft_store: Array.isArray(parsed.all_draft_store) ? parsed.all_draft_store : [],
      draft_ids: Array.isArray(parsed.draft_ids) ? parsed.draft_ids : [],
      root_path: typeof parsed.root_path === "string" ? parsed.root_path : projectsRoot,
    };
  } else {
    root = { all_draft_store: [], draft_ids: [], root_path: projectsRoot };
  }

  // Identity comes from the directory on disk, never the (possibly stale)
  // sidecar — a draft generated at path A then copied to path B still
  // carries A's name/path in draft_meta_info.json.
  const draftName = basename(draftDir);
  let draftId = typeof meta.draft_id === "string" && meta.draft_id ? meta.draft_id : randomUUID();
  // Same draft_id already used by a *different* folder (e.g. `cp -r`) ⇒
  // this copy needs its own id or CapCut collapses them.
  if (root.all_draft_store.some((e) => e.draft_id === draftId && e.draft_fold_path !== draftDir)) {
    draftId = randomUUID();
  }

  // Keep the sidecar consistent with where the draft actually lives so
  // CapCut and root_meta_info.json agree.
  let sidecarDirty = false;
  if (meta.draft_name !== draftName) {
    meta.draft_name = draftName;
    sidecarDirty = true;
  }
  if (meta.draft_fold_path !== draftDir) {
    meta.draft_fold_path = draftDir;
    sidecarDirty = true;
  }
  if (meta.draft_id !== draftId) {
    meta.draft_id = draftId;
    sidecarDirty = true;
  }
  if (sidecarDirty) writeFileSync(metaPath, JSON.stringify(meta), "utf-8");

  // Idempotent on the on-disk location: re-registering the same dir is a no-op.
  if (root.all_draft_store.some((e) => e.draft_fold_path === draftDir)) {
    return { draftId, draftName, rootMetaPath, added: false };
  }

  root.all_draft_store.push(buildEntry(draftDir, meta, projectsRoot));
  if (!root.draft_ids.includes(draftId)) root.draft_ids.push(draftId);

  writeFileSync(rootMetaPath, JSON.stringify(root, null, 0), "utf-8");
  return { draftId, draftName, rootMetaPath, added: true };
}

export function cmdRegister(positional: string[], flags: Flags): void {
  const draftDir = positional[1];
  if (!draftDir) die("Usage: capcut-david register <draft-dir> [--projects-root <dir>]");
  const result = registerDraft({ draftDir, projectsRoot: flags.projectsRoot });
  out(
    {
      ok: true,
      draft_id: result.draftId,
      draft_name: result.draftName,
      root_meta_path: result.rootMetaPath,
      added: result.added,
    },
    flags,
  );
}
