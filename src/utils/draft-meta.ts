import { nowUs } from "./capcut-paths.js";

// Canonical draft_meta_info.json builder — the sidecar CapCut reads to LIST a
// draft in its UI (and that `register` needs to exist). Extracted verbatim from
// pipeline.ts so `psycho-build` and `init-meta` emit a byte-identical sidecar.
// Keep this a pure cut-paste: a reordered key or changed default would alter the
// bytes psycho-build writes and break real drafts.
export function buildDraftMetaInfo(opts: {
  draftId: string;
  draftName: string;
  draftFoldPath: string;
  draftRootPath: string;
  totalDurationUs: number;
}): Record<string, unknown> {
  const now = nowUs();
  return {
    cloud_draft_cover: false,
    cloud_draft_sync: false,
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: "",
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: "draft_cover.jpg",
    draft_deeplink_url: "",
    draft_enterprise_info: {
      draft_enterprise_extra: "",
      draft_enterprise_id: "",
      draft_enterprise_name: "",
      enterprise_material: [],
    },
    draft_fold_path: opts.draftFoldPath,
    draft_id: opts.draftId,
    draft_is_ae_produce: false,
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_cloud_temp_draft: false,
    draft_is_from_deeplink: "false",
    draft_is_invisible: false,
    draft_is_web_article_video: false,
    draft_materials: [
      { type: 0, value: [] },
      { type: 1, value: [] },
      { type: 2, value: [] },
      { type: 3, value: [] },
      { type: 6, value: [] },
      { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: opts.draftName,
    draft_need_rename_folder: false,
    draft_new_version: "164.0.0",
    draft_removable_storage_device: "",
    draft_root_path: opts.draftRootPath,
    draft_segment_extra_info: [],
    draft_timeline_materials_size_: 0,
    draft_type: "",
    draft_web_article_video_enter_from: "",
    tm_draft_cloud_completed: "",
    tm_draft_cloud_entry_id: -1,
    tm_draft_cloud_modified: 0,
    tm_draft_cloud_parent_entry_id: -1,
    tm_draft_cloud_space_id: -1,
    tm_draft_create: now,
    tm_draft_modified: now,
    tm_draft_removed: 0,
    tm_duration: opts.totalDurationUs,
  };
}
