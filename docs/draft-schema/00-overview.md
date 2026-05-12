# 00 — Overview

> ℹ The reverse-engineering notes and a future `COMPATIBILITY.md` live in the upstream planning vault. The polished, in-repo reference is what you're reading now — see [the project repo](https://github.com/Davidb-2107/capcut-cli-david) for the published code.

`draft_content.json` is the canonical timeline document for a CapCut / Jianying project. Every clip, caption, keyframe, transition, sticker, mask, effect, and filter lives in this single file. CapCut reads it on project open, writes it on every save, and rotates a `.bak` copy.

`capcut-cli-david` operates exclusively on `draft_content.json` (and its sibling `draft_info.json`). All other files in a draft folder are auxiliary (caches, UI state, cover snapshot).

> ⚠ Every numeric time value in this schema is in **microseconds** (1 s = 1 000 000 μs). Coordinates are normalised, center-origin, range `[-1, 1]`, Y points up.

---

## Draft folder layout

A draft is a directory under the configured drafts root.

| OS | Drafts root |
|---|---|
| Windows | `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\<draftId>` |
| macOS | `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<draftId>` |

`cutcli` and `capcut-cli-david` identify a draft by **folder name = draftId**.

```
<drafts-root>/<draftId>/
├── draft_content.json          ← the file this doc describes
├── draft_content.json.bak      ← previous save (CapCut keeps one rotation)
├── draft_info.json             ← legacy mirror — older CapCut reads this first
├── draft_info.json.bak
├── draft_meta_info.json        ← list-row metadata (cover, name, timing)
├── draft.extra                 ← path-placeholder mapping (small binary)
├── draft_agency_config.json
├── draft_biz_config.json
├── draft_settings
├── draft_cover.jpg             ← thumbnail used by the draft list
├── template-2.tmp              ← stale snapshot, ignore
├── timeline_layout.json
├── attachment_editing.json
├── attachment_pc_common.json
├── key_value.json
├── performance_opt_info.json
├── Resources/                  ← media imported into the draft
├── Timelines/                  ← thumbnail strip cache
└── adjust_mask/  matting/  smart_crop/  subdraft/  qr_upload/  common_attachment/
```

**Rule:** for programmatic edits, only `draft_content.json` and `draft_info.json` matter — keep both in sync. cutcli writes them identically. `capcut-cli-david` does the same.

### Path placeholders

Media paths inside `draft_content.json` use a relocation token:

```
##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##\Resources\<asset>.png
```

CapCut resolves the placeholder at load time from `draft.extra`. The UUID inside the token is rewritten when the draft is moved. The port preserves placeholders verbatim on read/write and only emits them on `create` operations.

---

## Top-level shape

```jsonc
{
  "id": "4d638dda-4608-4ede-972d-f2e03c7e638a",   // draft UUID
  "name": "",                                       // display name (often empty)
  "duration": 60000000,                             // μs total timeline length
  "fps": 30.0,
  "version": 360000,                                // schema version integer
  "new_version": "167.0.0",                         // human version string
  "draft_type": "video",

  "platform": {                                     // emitting client identity
    "os": "mac", "os_version": "15.7.3",
    "app_id": 359289, "app_version": "8.2.0", "app_source": "cc",
    "device_id": "...", "hard_disk_id": "...", "mac_address": "..."
  },
  "last_modified_platform": { /* same shape as platform */ },

  "canvas_config": { "ratio": "original", "width": 1080, "height": 1920, "background": null },
  "color_space": -1,
  "config": { /* ~70-key UI/editor state blob — preserved verbatim */ },

  "mutable_config": null, "extra_info": null,
  "free_render_index_mode_on": false,
  "render_index_track_mode_on": false,
  "is_drop_frame_timecode": false,
  "create_time": 0, "update_time": 0,
  "cover": null, "retouch_cover": null, "static_cover_image_path": "",
  "source": "default", "path": "",
  "function_assistant_info": null,
  "lyrics_effects": [],
  "uneven_animation_template_info": null,
  "time_marks": null, "smart_ads_info": null, "group_container": null,
  "relationships": [],

  "keyframe_graph_list": [],   // see 03-keyframes-and-animations
  "keyframes": { /* legacy 8-bucket holder — see 03-keyframes-and-animations §4 */ },

  "materials": { /* see 02-materials */ },
  "tracks":    [ /* see 01-tracks-and-segments */ ]
}
```

All 36 top-level keys (sorted):

```
canvas_config, color_space, config, cover, create_time, draft_type, duration,
extra_info, fps, free_render_index_mode_on, function_assistant_info,
group_container, id, is_drop_frame_timecode, keyframe_graph_list, keyframes,
last_modified_platform, lyrics_effects, materials, mutable_config, name,
new_version, path, platform, relationships, render_index_track_mode_on,
retouch_cover, smart_ads_info, source, static_cover_image_path, time_marks,
tracks, uneven_animation_template_info, update_time, version
```

### TypeScript

```ts
export interface Draft {
  id: string;
  name: string;
  duration: number;            // μs
  fps: number;
  version: number;             // schema integer (e.g. 360000)
  new_version: string;         // human version (e.g. "167.0.0")
  draft_type: "video";
  platform: Platform;
  last_modified_platform: Platform;
  canvas_config: CanvasConfig;
  color_space: number;
  config: Record<string, unknown>;        // preserve verbatim
  mutable_config: null;
  extra_info: null;
  free_render_index_mode_on: boolean;
  render_index_track_mode_on: boolean;
  is_drop_frame_timecode: boolean;
  create_time: number;
  update_time: number;
  cover: null;
  retouch_cover: null;
  static_cover_image_path: string;
  source: string;
  path: string;
  function_assistant_info: null;
  lyrics_effects: unknown[];
  uneven_animation_template_info: null;
  time_marks: null;
  smart_ads_info: null;
  group_container: null;
  relationships: unknown[];
  keyframe_graph_list: KeyframeGraphRef[];
  keyframes: LegacyKeyframesHolder;
  materials: Materials;
  tracks: Track[];
}

export interface Platform {
  os: "mac" | "windows" | string;
  os_version: string;
  app_id: number;
  app_version: string;
  app_source: string;          // "cc" for CapCut
  device_id: string;
  hard_disk_id: string;
  mac_address: string;
}

export interface CanvasConfig {
  ratio: "original" | "1:1" | "9:16" | "16:9" | string;
  width: number;
  height: number;
  background: string | null;
}
```

---

## ID & UUID rules

- All IDs in the schema are GUID/UUID-4.
- Two casings coexist in the wild: lowercase hex (`9f5c0a03-076f-4490-a914-95e4a0ef9cf7`, cutcli output) and uppercase mac-style (`E33B114A-D366-443D-8F6B-2B7342758FA5`, native CapCut). **Both are valid on read.** `capcut-cli-david` emits lowercase UUIDv4 on every write.
- A material is referenced by **exactly one** ID. When adding a video segment: create a `materials.videos[]` entry → capture its `id` → set `segment.material_id` to that id.
- Peripheral materials (canvases, speeds, …) are likewise 1:1 with the segment that owns them — never reused across segments.
- `extra_material_refs` order matters (see `01-tracks-and-segments` §2.2).
- `render_index` collisions are tolerated; CapCut tiebreaks by array order. Bump in increments of 100 when stacking effects to leave headroom.

---

## Duration invariant

```ts
draft.duration = Math.max(
  draft.duration,
  ...allSegments.map(s => s.target_timerange.start + s.target_timerange.duration)
);
```

`capcut-cli-david` recomputes this on every write. CapCut tolerates a too-small `duration` (it truncates playback) but flickers on the seek bar — fail closed.

---

## Schema versioning

Sample drafts on disk:

| `version` int | `new_version` | CapCut release | Source |
|---|---|---|---|
| `360000` | `"167.0.0"` | CapCut 8.2.x | cutcli output |
| `360000` | `"169.0.0"` | CapCut 8.4.x | CapCut UI captures (Point 1b) |
| ≤ `359999` | various | earlier 8.x / 7.x | untested, likely compatible |

The integer `version` field is the load-time gate. Human `new_version` is informational.

**Rules:**
1. When **reading** an existing draft, preserve `version` and `new_version` byte-for-byte.
2. When **creating** a new draft, copy whatever cutcli currently emits (`360000` / `167.0.0` as of 2026-05-11).
3. When **patching**, never touch the version fields.

Per-version field diffs (e.g. CapCut 167.x emits `loudnesses` in `extra_material_refs`, 169.x omits it) are tracked in `05-version-differences.md`.

---

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Caption shows for one frame | Times in ms instead of μs (`end: 3000` instead of `3000000`) | Multiply by 1 000 000 |
| Image stretches when zooming | Only `KFTypeScaleX` keyframes, no `KFTypeScaleY` | Always animate both axes together |
| Keyframes ignored | `time_offset` treated as global — it is **relative** to segment start | Range `0 … segment.target_timerange.duration` |
| Animation plays too fast | `inAnimationDuration + outAnimationDuration > segment.duration` | Cap to ≤ segment duration |
| New segment invisible | Missing peripheral materials (canvas, speed, …) | Emit the full `extra_material_refs` set (see 01-tracks-and-segments §2.2) |
| Draft doesn't appear in CapCut | Wrong drafts dir / folder name ≠ `draft.id` | Verify the path; folder name and `draft.id` must match |
| Two segments overlap visually | Same `render_index` AND same `track_render_index` | Bump `render_index` by 100 |
| `clip.scale` ignored | `common_keyframes` overrides static `clip` | Set keyframe at `time_offset: 0` to the desired start scale |
| Audio segment errors | `clip` set to non-null on audio | Use `clip: null` and `uniform_scale: null` on audio/effect/filter |

---

## Glossary

| Term | Meaning |
|---|---|
| **μs** | microseconds — the only time unit in the schema. 1 s = 1 000 000 μs |
| **Normalised coordinate** | `[-1, 1]` value on each axis; origin at canvas centre; Y points up |
| **Segment-local** | Coordinate space whose origin is the segment's bounding box centre (used by masks) |
| **Outgoing segment** | The first segment of an A → B transition pair (A); carries the transition ref |
| **Incoming segment** | The second segment of an A → B transition pair (B); unmodified |
| **Catalogue asset** | Sticker / filter / animation / effect identified by `resource_id` against CapCut's effect cache |
| **Polymorphic slot** | `extra_material_refs[2]` on video segments — fills with `transitions` OR `common_mask` depending on the feature attached |

---

## Read next

- `01-tracks-and-segments.md` — track types, segment fields, ref ordering
- `02-materials.md` — videos, audios, texts (+ embedded styling JSON), peripherals
- `03-keyframes-and-animations.md` — `common_keyframes`, Bezier graphs, Ken Burns, in/out animations
- `04-effects-filters-stickers.md` — stickers, transitions, masks, filters, video_effects
- `05-version-differences.md` — CapCut 167 vs 169, JianYing delta, OS paths, forward-compat
