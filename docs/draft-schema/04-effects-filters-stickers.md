# 04 — Effects, Filters, Stickers, Transitions, Masks

The "feature" materials — everything beyond plain video / audio / text. Five concerns covered here, each with its own material slot, binding mechanism, and (sometimes) dedicated track type:

| Feature | Material slot | Track type | Binding |
|---|---|---|---|
| Sticker | `materials.stickers[]` | `"sticker"` | `segment.material_id` on sticker track; animations via `extra_material_refs[0]` |
| Transition | `materials.transitions[]` | (none — lives on video track) | **Outgoing segment's `extra_material_refs[2]`** (polymorphic slot) |
| Mask | `materials.common_mask[]` | (none — lives on video track) | Masked segment's `extra_material_refs[2]` (polymorphic slot) + `enable_video_mask: true` |
| Filter (CapCut UI) | `materials.effects[]` | `"filter"` | `segment.material_id` on filter track |
| Effect (video FX) | `materials.video_effects[]` | `"effect"` | `segment.material_id` on effect track |

> ⚠ The polymorphic `extra_material_refs[2]` slot accepts **either** a transition ref **or** a mask ref, never both simultaneously in captured fixtures. Plain video segments omit the slot — index 2 jumps directly to `canvases[]`.

---

## 1 · Stickers

Stickers play back on a **dedicated `"sticker"` track type** (not a video track with a flag — `track.type === "sticker"` literally).

### 1.1 · `materials.stickers[]` entry

```jsonc
{
  "id":            "10BDBF84-9DD7-53CC-A0F0-23922BE33781",
  "type":          "sticker",
  "name":          "Simple Artistic Circle",   // CapCut catalogue name — preserve verbatim
  "resource_id":   "7237287015903972613",       // catalogue ID
  "category_name": "Trending",                  // catalogue category
  /* …plus path, source_platform, request_id, panel — standard catalogue-asset fields… */
}
```

The shape mirrors `video_effects[]` (catalogue lookup pattern). cutcli's `sticker add --sticker-id X --scale Y` writes the same shape.

### 1.2 · Sticker track + segment

```jsonc
{
  "id": "...", "type": "sticker", "flag": 0,
  "attribute": 0, "name": "", "is_default_name": true,
  "segments": [
    {
      "id":          "...",
      "material_id": "10BDBF84-...",                         // → materials.stickers[0]
      "extra_material_refs": [ "<material_animations id>" ], // entrance/exit animations
      "target_timerange": { "start": 0, "duration": 3000000 },
      "source_timerange": null,
      "clip": { /* full transform — sticker position/scale/rotation lives here */ },
      "uniform_scale": { "on": false, "value": 1.0 },
      /* …all the standard segment fields… */
    }
  ]
}
```

### 1.3 · Sticker animations

Same mechanism as text — a `material_animations[]` entry referenced via `segment.extra_material_refs[0]`. Inside the entry, `material_type` is literally `"sticker"` (and is the same value used for text bundles — the field name is misleading). See `03-keyframes-and-animations.md` §4.

### 1.4 · TypeScript

```ts
export interface StickerMaterial {
  id: string;
  type: "sticker";
  name: string;                 // catalogue name, preserve verbatim
  resource_id: string;
  category_name: string;
  path: string;
  source_platform: number;
  request_id: string;
  panel: string;
  /* …additional catalogue-asset fields preserved verbatim… */
}
```

---

## 2 · Transitions

Transitions live in `materials.transitions[]` and bind to the **outgoing segment** (the segment BEFORE the cut) via `extra_material_refs[2]`. They DO NOT use a dedicated `transition_id` field on the segment.

### 2.1 · `materials.transitions[]` entry

```jsonc
{
  "id":            "773F277B-970E-4afa-9CD7-557E922BAAE2",
  "type":          "transition",
  "name":          "Dissolve",                       // catalogue name — preserve verbatim
  "resource_id":   "6724846004274729480",            // catalogue ID
  "category_name": "Transitions",
  "duration":      466666,                            // μs — must be ≤ shorter neighbour segment
  "is_overlap":    true,                              // see rules below
  /* …plus path, source_platform, panel, request_id… */
}
```

### 2.2 · Binding — outgoing segment carries the ref

Take two video segments A → B with a transition between them. The transition material id is **inserted at index 2** of A's `extra_material_refs` (between `placeholder_infos[1]` and `canvases[3]`). B is unmodified.

```jsonc
// Outgoing segment A — 7 refs (with transition slot filled)
"extra_material_refs": [
  "<speeds_A>",                      // 0
  "<placeholder_infos_A>",           // 1
  "773F277B-...",                     // 2 ← THE BINDING
  "<canvases_A>",                    // 3
  "<sound_channel_mappings_A>",      // 4
  "<material_colors_A>",             // 5
  "<vocal_separations_A>"            // 6
]
// Incoming segment B — 6 refs, no transition slot
```

### 2.3 · Rules

- Only the **outgoing** segment carries the transition ref. Do NOT also add it to the incoming segment.
- `duration` in `materials.transitions[]` is the playback length; CapCut overlaps the two segments by half this duration on each side (the transition is centred on the cut point).
- `is_overlap: true` (default) means the transition consumes time from both segments equally. With `is_overlap: false` the transition is added between them, extending the timeline by the transition duration.
- The first segment of a track cannot be an "incoming" side (no predecessor). The last segment cannot be "outgoing" (no successor) — emitting a transition ref on the last segment is silently dropped by CapCut.

### 2.4 · TypeScript

```ts
export interface Transition {
  id: string;
  type: "transition";
  name: string;                 // catalogue name
  resource_id: string;
  category_name: "Transitions" | string;
  duration: number;             // μs
  is_overlap: boolean;
  path: string;
  source_platform: number;
  panel: string;
  request_id: string;
  /* …additional catalogue-asset fields preserved verbatim… */
}
```

---

## 3 · Masks

Masks live in `materials.common_mask[]` and bind to the masked segment via the **same polymorphic optional slot** at `extra_material_refs[2]` (mutually exclusive with transitions). They additionally require the segment's `enable_video_mask` flag to be `true`.

### 3.1 · `materials.common_mask[]` entry

```jsonc
{
  "id":             "4244BCF1-8077-5430-9E47-39193C80FF97",
  "type":           "mask",
  "name":           "Circle",                       // English name
  "resource_type":  "circle",                       // shape token (§3.3)
  "resource_id":    "7374021188315517456",
  "category":       "video",
  "category_name":  "",

  "config": {                                       // shape-agnostic geometry
    "width":       0.5,                              // normalised [0,1]
    "height":      0.28,                             // normalised [0,1]
    "centerX":     0.0,                              // normalised [-1,1] (segment-local)
    "centerY":     0.0,
    "rotation":    0.0,                              // degrees
    "feather":     0.0,                              // [0,1] edge softness
    "expansion":   0.0,                              // [-1,1] dilate/erode
    "roundCorner": 0.0,                              // rectangle only
    "invert":      false,                            // flip masked region
    "aspectRatio": 1.0
  },

  "text_config": {                                  // populated only for TEXT-shaped masks
    "content": "", "font_name": "", "font_path": "",
    "font_size": 15.0, "bold_width": 0.0, "italic_degree": 0,
    "has_underline": false, "line_gap": 0.0, "char_spacing": 0.0,
    "align_type": 15, "scale": 1.0
  },
  /* …plus path, constant_material_id, platform, source_platform, panel, position_info… */
}
```

### 3.2 · Binding

The mask material id occupies the optional slot at `extra_material_refs[2]` of the masked video segment (same position used by transitions in §2 — never both simultaneously in captures).

```jsonc
"extra_material_refs": [
  "<speeds>",                 // 0
  "<placeholder_infos>",      // 1
  "4244BCF1-...",              // 2 ← THE BINDING
  "<canvases>",               // 3
  "<sound_channel_mappings>", // 4
  "<material_colors>",        // 5
  "<vocal_separations>"       // 6
]
```

And the segment must carry `enable_video_mask: true` (default `false` in fresh segments) to actually render the mask. Related flags gate independent features that build on top of the base mask:

| Flag | Gates |
|---|---|
| `enable_video_mask` | The mask itself |
| `enable_adjust_mask` | Per-segment color adjustments within the mask region |
| `enable_mask_stroke` | Decorative stroke around the mask edge |
| `enable_mask_shadow` | Drop shadow on the mask edge |

### 3.3 · `resource_type` values

Captured: `"circle"`. cutcli's name map suggests the full set:

| `resource_type` | CN | Shape |
|---|---|---|
| `linear` | 线性 | Linear / gradient |
| `mirror` | 镜面 | Mirror |
| `circle` | 圆形 | Circle |
| `rectangle` | 矩形 | Rectangle (uses `config.roundCorner`) |
| `star` | 星形 | Star |
| `heart` | 爱心 | Heart |
| `text` | 文字 | Text-shaped (uses `text_config`) |

### 3.4 · Coordinate conventions

- `centerX`, `centerY` are **segment-local normalised** — origin at the segment's centre, `[-1, 1]` range.
- `width`, `height` are normalised against the segment's bounding box (NOT the canvas).
- `rotation` is in degrees, clockwise from horizontal.
- `aspectRatio` constrains width/height ratio when interactively resizing in CapCut UI; the port can preserve it verbatim and ignore the constraint when writing.

### 3.5 · TypeScript

```ts
export type MaskResourceType =
  | "linear" | "mirror" | "circle" | "rectangle" | "star" | "heart" | "text";

export interface Mask {
  id: string;
  type: "mask";
  name: string;
  resource_type: MaskResourceType;
  resource_id: string;
  category: "video" | string;
  category_name: string;
  config: MaskConfig;
  text_config: MaskTextConfig;
  path: string;
  constant_material_id: string;
  platform: string;
  source_platform: number;
  panel: string;
  position_info: unknown;
}

export interface MaskConfig {
  width: number;            // normalised [0,1]
  height: number;           // normalised [0,1]
  centerX: number;          // normalised [-1,1], segment-local
  centerY: number;
  rotation: number;         // degrees
  feather: number;          // [0,1]
  expansion: number;        // [-1,1]
  roundCorner: number;      // rectangle only
  invert: boolean;
  aspectRatio: number;
}

export interface MaskTextConfig {
  content: string;
  font_name: string;
  font_path: string;
  font_size: number;
  bold_width: number;
  italic_degree: number;
  has_underline: boolean;
  line_gap: number;
  char_spacing: number;
  align_type: number;
  scale: number;
}
```

---

## 4 · Filters

> **Filter intensity range: `[0, 1]`.** The CapCut UI slider runs 0–100, the JSON stores `slider ÷ 100`. Verified: Vintage at slider 50 → `value: 0.5`.

### 4.1 · CapCut UI vs cutcli — two different routes

CapCut UI and cutcli route filters to **different material slots** and **different track types**:

| Source | Material slot | Track type |
|---|---|---|
| CapCut UI "Filters" panel | `materials.effects[]` | `"filter"` |
| CapCut UI "Effects" panel (video FX) | `materials.video_effects[]` | `"effect"` |
| cutcli `filters add` | `materials.video_effects[]` | `"effect"` |
| cutcli `effects add` | `materials.video_effects[]` | `"effect"` |

If you read a draft and find `materials.effects[]` populated, treat it as a CapCut-UI filter and emit on the `"filter"` track. If you find `materials.video_effects[]` populated with `type: "filter"`, that's a cutcli filter routed through the effect track. The two routes are mutually exclusive in captures so far.

### 4.2 · `materials.effects[]` entry (CapCut UI filter)

```jsonc
{
  "id":             "BDF12766-20BF-5E6B-A00F-4EFA1A71F964",
  "type":           "filter",
  "name":           "Vintage",                          // catalogue — preserve verbatim
  "resource_id":    "6706773528277946894",
  "effect_id":      "6706773528277946894",              // matches resource_id for filters
  "category_name":  "Filters",
  "category_id":    "123456",
  "value":          0.5,                                 // intensity in [0,1]
  "apply_target_type": 0,                                // 0 = segment-local, 2 = global
  "adjust_params":  [],                                  // per-param tweaks (usually empty for filters)
  "visible":        true,
  "item_effect_type": 0,
  "time_range":     null,
  "common_keyframes": [],                                // filters can be keyframed too
  /* …plus path, source_platform, version, request_id, color_match_info,
     bloom_params, beauty_face_auto_*, smart_color_mode, etc. — preserve all on read… */
}
```

### 4.3 · `materials.video_effects[]` entry (cutcli filter)

Same shape as the effect entry in §5 — the `type` field distinguishes (`"filter"` vs `"video_effect"`). For a cutcli-generated filter, `value` is also in `[0, 1]` (cutcli scales the CLI's `0..100` down by /100 before writing).

### 4.4 · Filter track + segment

Filters from CapCut UI sit on their own `"filter"`-typed track (NOT `"effect"`). Segment shape is minimal:

```jsonc
{
  "id": "...", "type": "filter", "flag": 0,
  "attribute": 0, "name": "", "is_default_name": true,
  "segments": [
    {
      "id":          "...",
      "material_id": "BDF12766-...",
      "extra_material_refs": [],
      "target_timerange": { "start": 0, "duration": 5000000 },
      "source_timerange": null,
      "clip": null, "uniform_scale": null,
      "render_index": 11000, "track_render_index": 4,
      /* …standard segment fields with default values… */
    }
  ]
}
```

### 4.5 · `apply_target_type` enum

| Value | Meaning | Binding |
|---|---|---|
| `0` | Segment-only — filter applies to the one clip directly below | `bind_segment_id` field on the filter material |
| `2` | Global / track-wide — filter applies to all video below it on the timeline | (no extra binding — applies to whatever the filter segment overlaps) |

Used by both `materials.effects[]` (filters) and `materials.video_effects[]` (effects).

### 4.6 · TypeScript

```ts
export interface FilterMaterial {
  id: string;
  type: "filter";
  name: string;                 // catalogue name
  resource_id: string;
  effect_id: string;            // matches resource_id for filters
  category_name: "Filters" | string;
  category_id: string;
  value: number;                // [0, 1]
  apply_target_type: 0 | 2;
  adjust_params: AdjustParam[];
  visible: boolean;
  item_effect_type: number;
  time_range: Timerange | null;
  common_keyframes: KeyframeGroup[];
  path: string;
  source_platform: number;
  version: string;
  request_id: string;
  /* …additional rarely-touched fields preserved verbatim… */
}

export interface AdjustParam {
  name: string;                 // effect-specific (e.g. "effects_adjust_speed")
  value: number;                // [0, 1] regardless of UI label
  default_value: number;
}
```

---

## 5 · Effects (`materials.video_effects[]`)

Effects are the full-track video filters (VHS Horror, Glitch, Bokeh, …). One entry per effect-track segment. From `test-effect-clean` — a 61.5-second VHS Horror over the entire video:

```jsonc
{
  "id": "E2A68B17-2305-4205-83E1-480CC812E9F6",     // → segment.material_id
  "effect_id":   "7583016187584417032",
  "resource_id": "7583016187584417032",
  "name": "VHS Horror",
  "type": "video_effect",
  "sub_type": 0,
  "bind_segment_id": "",                              // bound to entire track when empty
  "transparent_params": "",
  "path": "C:/Users/.../Cache/effect/7583016187584417032/e20b03b7...",
  "value": 1.0,                                        // overall intensity
  "category_id": "1111", "category_name": "Video effects",
  "platform": "all",
  "apply_target_type": 2,                              // 2 = global / track-wide
  "source_platform": 1,
  "version": "",
  "item_effect_type": 0,
  "adjust_params": [
    { "name": "effects_adjust_speed",
      "value": 0.33333333333333,
      "default_value": 0.33333333333333 }
  ],
  "time_range": null,
  "formula_id": "",
  "apply_time_range": null,
  "render_index": 0,
  "track_render_index": 0,
  "common_keyframes": [],                              // effects can be keyframed too
  "request_id": "",
  "algorithm_artifact_path": "",
  "disable_effect_faces": [],
  "covering_relation_change": 0,
  "enable_mask": true,
  "effect_mask": [],
  "enable_video_mask_stroke": true,
  "enable_video_mask_shadow": true
}
```

### 5.1 · Effect track + segment

```jsonc
{
  "id": "E33B114A-...", "type": "effect", "flag": 0, "attribute": 0,
  "name": "", "is_default_name": true,
  "segments": [
    {
      "id": "5D4F4286-...",
      "material_id": "E2A68B17-...",          // → video_effect above
      "extra_material_refs": [],
      "target_timerange": { "start": 0, "duration": 61566666 },
      "source_timerange": null,
      "clip": null, "uniform_scale": null,
      "render_index": 11000, "track_render_index": 3,
      /* …standard segment fields with default values… */
    }
  ]
}
```

### 5.2 · Notes

- `apply_target_type: 2` ⇒ effect applies to all video below it on the timeline. Use `0` for "this segment only" (binds via `bind_segment_id`).
- `adjust_params[]` — each entry tweaks one effect parameter; names are effect-specific. `value` is on `[0, 1]` regardless of the param's UI label.
- `render_index: 11000` is high so the effect sits above all video segments. CapCut auto-bumps it when stacking effects — leave headroom by bumping in increments of 100.

### 5.3 · TypeScript

```ts
export interface VideoEffect {
  id: string;
  effect_id: string;
  resource_id: string;
  name: string;                 // catalogue name
  type: "video_effect" | "filter";
  sub_type: number;
  bind_segment_id: string;      // "" for track-wide
  transparent_params: string;
  path: string;
  value: number;                // [0, 1]
  category_id: string;
  category_name: string;
  platform: string;
  apply_target_type: 0 | 2;
  source_platform: number;
  version: string;
  item_effect_type: number;
  adjust_params: AdjustParam[];
  time_range: Timerange | null;
  formula_id: string;
  apply_time_range: Timerange | null;
  render_index: number;
  track_render_index: number;
  common_keyframes: KeyframeGroup[];
  request_id: string;
  algorithm_artifact_path: string;
  disable_effect_faces: unknown[];
  covering_relation_change: number;
  enable_mask: boolean;
  effect_mask: unknown[];
  enable_video_mask_stroke: boolean;
  enable_video_mask_shadow: boolean;
}
```

---

## 6 · Rules summary

1. **Sticker** → dedicated `"sticker"` track + `materials.stickers[]`. Animations via `extra_material_refs[0]`.
2. **Transition** → outgoing segment carries the ref at `extra_material_refs[2]`. Never on the incoming segment. Last segment cannot be outgoing.
3. **Mask** → masked segment's `extra_material_refs[2]` AND `enable_video_mask: true`. Polymorphic slot — mutually exclusive with transitions.
4. **Filter (CapCut UI)** → `materials.effects[]` + `"filter"` track. **Intensity is `[0, 1]`** (slider ÷ 100).
5. **Effect / cutcli filter** → `materials.video_effects[]` + `"effect"` track.
6. The port reads both routes (CapCut UI vs cutcli) and emits the route matching the source draft (or cutcli's route on `create`).
