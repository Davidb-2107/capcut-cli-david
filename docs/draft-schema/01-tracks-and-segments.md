# 01 — Tracks and Segments

`draft.tracks` is an ordered array of **track objects**. Each track owns a list of **segments** along the timeline. Six track types exist; segments share a single 49-field shape regardless of track type, with type-specific fields nulled.

> Track order is z-order: later tracks render **on top** when `render_index` ties.

---

## 1 · Track types

```jsonc
{
  "id":     "2D0629D7-BC55-4A90-867A-C078CFEEE0D2",
  "type":   "video",          // see table below
  "flag":   0,                // 0 = primary, 3 = secondary/overlay
  "attribute": 0,
  "name": "",
  "is_default_name": false,
  "segments": [ /* see §2 */ ]
}
```

| `type` | `flag` | Role | Source material |
|---|---|---|---|
| `video` | `0` | Primary video / image strip | `materials.videos[]` |
| `audio` | `3` | Music, voiceover, extracted track | `materials.audios[]` |
| `text` | `3` | Overlay captions | `materials.texts[]` |
| `effect` | `0` | Global video-effect strip (e.g. VHS Horror) | `materials.video_effects[]` |
| `sticker` | `0` | Sticker / emoji / shape overlay | `materials.stickers[]` |
| `filter` | `0` | Color filter strip (e.g. Vintage) | `materials.effects[]` |

> ⚠ `effect` and `filter` are **distinct track types** that read from different material slots:
> - `effect` → `materials.video_effects[]` (written by both cutcli and CapCut UI)
> - `filter` → `materials.effects[]` (written only by CapCut UI; cutcli routes filters through `video_effects` instead)
>
> See `04-effects-filters-stickers.md` for the routing matrix.

A typical draft carries 1 video track + 1–2 audio tracks + 0–1 text track + 0–1 effect track. Sticker and filter tracks appear only when the user explicitly adds those features in CapCut UI. `cutcli` always creates a fresh track per `<module> add` call when no matching track exists; `capcut-cli-david` follows the same convention.

### TypeScript

```ts
export type TrackType = "video" | "audio" | "text" | "effect" | "sticker" | "filter";
export type TrackFlag = 0 | 3;

export interface Track {
  id: string;
  type: TrackType;
  flag: TrackFlag;
  attribute: 0;
  name: string;
  is_default_name: boolean;
  segments: Segment[];
}
```

---

## 2 · Segment shape

All 49 fields are present on every segment regardless of track type. Unused fields take type-appropriate null/defaults (see §2.1).

```jsonc
{
  "id": "631a9e50-43c1-448b-8ee9-a191f1d33b8c",          // segmentId (UUID)
  "material_id": "62842301-8666-4f71-9224-045d283d722d", // → materials.<videos|texts|audios|...>[].id
  "extra_material_refs": [ "...", "..." ],               // §2.2 — peripheral material links

  /* Timing — μs */
  "target_timerange":  { "start": 0,       "duration": 733333 },   // on the timeline
  "source_timerange":  { "start": 0,       "duration": 733333 },   // inside the source media (null for text/effect/filter)
  "render_timerange":  { "start": 0,       "duration": 0 },        // usually 0/0

  /* Transform (video / text / sticker only — null on audio/effect/filter) */
  "clip": {
    "scale":     { "x": 1.0, "y": 1.0 },
    "rotation":  0.0,                                   // degrees
    "transform": { "x": 0.0, "y": 0.0 },                // position, normalised [-1,1]
    "flip":      { "vertical": false, "horizontal": false },
    "alpha":     1.0
  },
  "uniform_scale": { "on": false, "value": 1.0 },       // when on=true, scale.x === scale.y

  /* Audio */
  "volume":             1.0,
  "last_nonzero_volume": 1.0,
  "speed":              1.0,         // playback rate; mirrored in linked speeds[] material
  "is_loop":            false,
  "reverse":            false,
  "is_tone_modify":     false,
  "intensifies_audio":  false,

  /* Animation */
  "common_keyframes": [ /* see 03-keyframes-and-animations */ ],
  "keyframe_refs":    [],            // legacy — empty when common_keyframes is used
  "lyric_keyframes":  null,

  /* Render order */
  "render_index":       0,           // z-order tiebreaker inside a track
  "track_render_index": 2,           // z-order across tracks
  "visible":            true,

  /* Misc flags (almost always defaults) */
  "state": 0, "desc": "", "cartoon": false,
  "group_id": "", "raw_segment_id": "", "template_id": "", "template_scene": "default",
  "is_placeholder": false, "source": "segmentsourcenormal",
  "track_attribute": 0,
  "responsive_layout": { "enable": false, "target_follow": "", "size_layout": 0,
                         "horizontal_pos_layout": 0, "vertical_pos_layout": 0 },
  "hdr_settings": { "mode": 1, "intensity": 1.0, "nits": 1000 },
  "caption_info": null,
  "digital_human_template_group_id": "",
  "color_correct_alg_result": "",

  /* Enable bitfields — preserve verbatim on round-trip */
  "enable_lut": true, "enable_adjust": true, "enable_hsl": true,
  "enable_color_curves": true, "enable_hsl_curves": true,
  "enable_color_wheels": true, "enable_smart_color_adjust": false,
  "enable_color_match_adjust": false, "enable_color_correct_adjust": false,
  "enable_adjust_mask": true, "enable_video_mask": true,
  "enable_mask_stroke": false, "enable_mask_shadow": false,
  "enable_color_adjust_pro": false
}
```

### 2.1 · Defaults differ by track type

| Field | video | text | audio | effect | sticker | filter |
|---|---|---|---|---|---|---|
| `source_timerange` | object | **null** | object | **null** | **null** | **null** |
| `clip` | full object | full object | **null** | **null** | full object | **null** |
| `uniform_scale` | `{ on:false, value:1 }` | `{ on:`**`true`**`, value:1 }` | null | null | `{ on:false, value:1 }` | null |
| `hdr_settings` | full object | null | null | null | null | null |
| `volume` | 1.0 | 1.0 | 1.0 (effective) | 1.0 | 1.0 | 1.0 |
| `extra_material_refs` count | 6 or 7 | 1 | 4 | 0 | 1 | 0 |

> ⚠ For text segments, `uniform_scale.on` is `true` by default — text always scales uniformly.

### 2.2 · `extra_material_refs` — order matters

Each entry is a material ID resolved against `draft.materials`. **The order in the array is positional** — CapCut indexes by position, not by inspection.

#### Video segment

6 or 7 base refs, in this strict order:

| Idx | Bucket | When present |
|---|---|---|
| `0` | `speeds[]` | always |
| `1` | `placeholder_infos[]` | always |
| `2` | **OPTIONAL polymorphic slot** | only when a transition (§7 of root schema, `04-effects-…`) or a mask (§8) is attached. Holds a single ref. **Absent in plain segments.** |
| `3` | `canvases[]` | always |
| `4` | `sound_channel_mappings[]` | always |
| `5` | `material_colors[]` | always |
| `6` | `loudnesses[]` | cutcli (CapCut 167.x) only — **omitted by CapCut UI 169.x for unmodified clips** |
| `7` *(or `6` when `loudnesses` absent)* | `vocal_separations[]` | always |

Concrete cases observed:

```jsonc
// (a) cutcli output — CapCut 167.x, no transition, no mask: 7 refs
"extra_material_refs": [
  "<speeds>",                  // 0
  "<placeholder_infos>",       // 1
  "<canvases>",                // 2
  "<sound_channel_mappings>",  // 3
  "<material_colors>",         // 4
  "<loudnesses>",              // 5
  "<vocal_separations>"        // 6
]
```

```jsonc
// (b) CapCut UI 169.x — no transition, no mask: 6 refs (loudnesses omitted)
"extra_material_refs": [
  "<speeds>",
  "<placeholder_infos>",
  "<canvases>",
  "<sound_channel_mappings>",
  "<material_colors>",
  "<vocal_separations>"
]
```

```jsonc
// (c) CapCut UI 169.x with a transition on this (outgoing) segment: 7 refs
"extra_material_refs": [
  "<speeds>",                  // 0
  "<placeholder_infos>",       // 1
  "<transition_id>",           // 2 ← polymorphic slot filled
  "<canvases>",                // 3
  "<sound_channel_mappings>",  // 4
  "<material_colors>",         // 5
  "<vocal_separations>"        // 6
]
```

> ⚠ The polymorphic slot at index 2 is **mutually exclusive** in all captured fixtures — never both transition AND mask simultaneously. If the port stacks both, validate empirically.

#### Audio segment — 4 refs

```jsonc
"extra_material_refs": [
  "<speeds>",                  // 0
  "<placeholder_infos>",       // 1
  "<sound_channel_mappings>",  // 2
  "<vocal_separations>"        // 3
]
```

#### Text segment — 1 ref

```jsonc
"extra_material_refs": [
  "<material_animations>"      // 0 — entrance/exit/loop bundle (always provisioned, may have empty `animations: []`)
]
```

#### Sticker segment — 1 ref

```jsonc
"extra_material_refs": [
  "<material_animations>"      // 0 — sticker entrance/exit/loop (same shape as text — see 03-keyframes-and-animations §5)
]
```

#### Effect / Filter segment — 0 refs

```jsonc
"extra_material_refs": []
```

The effect or filter itself lives in `materials.video_effects[]` / `materials.effects[]`, referenced by `segment.material_id`. No extras.

---

## 3 · TypeScript surface

```ts
export interface Segment {
  id: string;
  material_id: string;
  extra_material_refs: string[];

  target_timerange: Timerange;
  source_timerange: Timerange | null;
  render_timerange: Timerange;

  clip: Clip | null;
  uniform_scale: { on: boolean; value: number } | null;

  volume: number;
  last_nonzero_volume: number;
  speed: number;
  is_loop: boolean;
  reverse: boolean;
  is_tone_modify: boolean;
  intensifies_audio: boolean;

  common_keyframes: KeyframeGroup[];
  keyframe_refs: string[];
  lyric_keyframes: null;

  render_index: number;
  track_render_index: number;
  visible: boolean;

  state: number;
  desc: string;
  cartoon: boolean;
  group_id: string;
  raw_segment_id: string;
  template_id: string;
  template_scene: string;
  is_placeholder: boolean;
  source: string;
  track_attribute: number;
  responsive_layout: ResponsiveLayout;
  hdr_settings: HdrSettings | null;
  caption_info: null;
  digital_human_template_group_id: string;
  color_correct_alg_result: string;

  enable_lut: boolean;
  enable_adjust: boolean;
  enable_hsl: boolean;
  enable_color_curves: boolean;
  enable_hsl_curves: boolean;
  enable_color_wheels: boolean;
  enable_smart_color_adjust: boolean;
  enable_color_match_adjust: boolean;
  enable_color_correct_adjust: boolean;
  enable_adjust_mask: boolean;
  enable_video_mask: boolean;       // gate for mask rendering — see 04-effects-…
  enable_mask_stroke: boolean;
  enable_mask_shadow: boolean;
  enable_color_adjust_pro: boolean;
}

export interface Timerange { start: number; duration: number; }

export interface Clip {
  scale: { x: number; y: number };
  rotation: number;
  transform: { x: number; y: number };
  flip: { vertical: boolean; horizontal: boolean };
  alpha: number;
}

export interface ResponsiveLayout {
  enable: boolean;
  target_follow: string;
  size_layout: number;
  horizontal_pos_layout: number;
  vertical_pos_layout: number;
}

export interface HdrSettings {
  mode: number;
  intensity: number;
  nits: number;
}
```

---

## 4 · Rules summary

1. **Every segment is fully shaped.** Never omit fields — emit nulls where the segment type doesn't use them.
2. **`extra_material_refs` is positional.** Order is documented above; do not sort, do not skip slots.
3. **The polymorphic slot at index 2** is filled by transition OR mask, never both (in captures so far). Plain segments OMIT the slot entirely — index 2 jumps directly to `canvases[]`.
4. **Render order is z-order.** Later tracks paint over earlier ones; within a track, higher `render_index` wins; ties break by array order.
5. **Round-trip preservation.** When reading then writing a draft, preserve every field — including the ~25 `enable_*` flags — verbatim.
6. **cutcli emits 167.x shape (with `loudnesses`); CapCut UI 169.x omits it.** The port reads both and emits the shape matching the source draft (or the cutcli shape on `create`).
