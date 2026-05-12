# 03 — Keyframes and Animations

Two independent animation systems coexist in `draft_content.json`:

1. **`segment.common_keyframes`** — per-segment property animation (scale, position, rotation, opacity). This is how Ken Burns, pan, zoom, fades are encoded.
2. **`materials.material_animations[]`** — text and sticker in/out/loop animations from CapCut's catalogue (Fade In, Bounce Out, ...). Linked to a segment via `extra_material_refs[0]`.

A third, legacy holder — top-level `draft.keyframes` — is documented for round-trip preservation but is **always empty** in modern drafts.

---

## 1 · `segment.common_keyframes` — property animation

All on-segment animation lives here. The `keyframes` top-level slot and the `keyframe_refs` segment field are legacy and unused by cutcli.

### 1.1 · Container

```jsonc
"common_keyframes": [
  {
    "id":            "9f5c0a03-076f-4490-a914-95e4a0ef9cf7",  // group UUID
    "material_id":   "",                                       // empty for clip transforms
    "property_type": "KFTypeScaleX",                           // see §1.2
    "keyframe_list": [ /* §1.3 */ ]
  }
]
```

One container per animated property. For Ken Burns you always emit **two** containers: `KFTypeScaleX` AND `KFTypeScaleY` (one alone distorts the image).

### 1.2 · `property_type` enum

Confirmed in samples:

| `property_type` | What it animates | `values` type |
|---|---|---|
| `KFTypeScaleX` | `clip.scale.x` | `[number]` — 1.0 = native |
| `KFTypeScaleY` | `clip.scale.y` | `[number]` — 1.0 = native |

Documented by cutcli for `cutcli keyframes add --property`:

| cutcli `property` | Inferred `property_type` |
|---|---|
| `scale_x` | `KFTypeScaleX` |
| `scale_y` | `KFTypeScaleY` |
| `position_x` | `KFTypePositionX` |
| `position_y` | `KFTypePositionY` |
| `rotation` | `KFTypeRotation` |
| `opacity` | `KFTypeAlpha` |

(See cutcli docs §`cutcli keyframes add` and example `05-keyframe-zoom-in`.)

### 1.3 · `keyframe_list[]` — individual keyframe

```jsonc
{
  "id":         "57f34721-f5d6-4b27-85d6-7994950fa3d4",
  "curveType":  "FreeCurveInOut",
  "time_offset": 0,                                       // μs RELATIVE to segment.target_timerange.start
  "left_control":  { "x": 0.0,       "y": 0.0   },        // incoming Bezier handle
  "right_control": { "x": 234667.0,  "y": -0.47 },        // outgoing Bezier handle
  "values":     [ 1.5 ],                                  // [scalar] for scalars; [x, y] for 2D properties
  "string_value": "",                                      // unused for numeric properties
  "graphID":    ""                                         // links to keyframe_graph_list (see §1.5)
}
```

**Coordinate convention for Bezier control points:**
- `x` = time offset in μs. `left_control.x` is **negative** (handle pulls into the past); `right_control.x` is **positive**.
- `y` = value delta on the property's native scale.

### 1.4 · `curveType` enum

| `curveType` | Meaning | cutcli `easing` | `graphID` populated? |
|---|---|---|---|
| `Line` | Linear interpolation | `linear` | no — empty string |
| `EaseIn` | Cubic ease-in | `ease_in` | no |
| `EaseOut` | Cubic ease-out | `ease_out` | no |
| `FreeCurveInOut` | Bezier-controlled (default for cutcli output) | `ease_in_out` | **yes** — links to a `keyframe_graph_list[]` entry |

cutcli writes `FreeCurveInOut` by default with stock control points giving a smooth ease (catalogue preset "Cubic Out").

### 1.5 · `keyframe_graph_list[]` — Bezier curve catalogue (top-level)

When a keyframe uses `curveType: "FreeCurveInOut"`, its `graphID` points to an entry in the **top-level `draft.keyframe_graph_list[]`** — a per-draft registry of Bezier easing presets actually used. cutcli emits one entry per `KFTypeScaleX` / `KFTypeScaleY` container.

```jsonc
{
  "id":            "4561E865-0913-59F0-B067-0B42A92BB6A3",
  "resource_id":   "7034098919583781377",
  "resource_name": "Cubic Out",                 // canonical CapCut preset name
  "source_platform": 1,
  "graph_points": []                            // populated only for hand-edited custom curves
}
```

Counts observed across fixtures (1:1 correspondence — `graph_points: []` because the curve is identified by `resource_id` alone):

| Fixture | graphIDs used | graph-list entries |
|---|---|---|
| ken-burns-draft | 10 | 10 |
| full-psycho-draft | 162 | 162 |
| effects-draft | 3 | 3 |

**Cross-reference is 100% in every keyframed fixture** — each keyframe `graphID` resolves to exactly one `keyframe_graph_list[].id`.

> ⚠ **Implementation rule.** When generating new keyframes with `curveType: "FreeCurveInOut"`:
> 1. Generate a fresh UUID for the keyframe's `graphID`.
> 2. Append a matching `keyframe_graph_list[]` entry with that UUID and the catalogue resource. cutcli always picks "Cubic Out" (`resource_id: "7034098919583781377"`).
>
> For `Line` / `EaseIn` / `EaseOut`, `graphID` is `""` and **no** graph-list entry is emitted.

### 1.6 · Top-level `keyframes` — legacy 8-bucket holder

The top-level `keyframes` field on the draft root is **not** a list — it's an object with eight typed buckets:

```jsonc
"keyframes": {
  "videos":     [],
  "audios":     [],
  "texts":      [],
  "stickers":   [],
  "filters":    [],
  "adjusts":    [],
  "handwrites": [],
  "effects":    []
}
```

In every sample on disk (cutcli AND CapCut UI 167 / 169) all eight buckets are empty. cutcli writes keyframes exclusively inside per-segment `common_keyframes`. The buckets are a legacy holder for keyframes-by-material-type that newer schema versions phased out.

**Rule:** preserve verbatim when round-tripping; emit the empty 8-bucket object when creating a fresh draft.

---

## 2 · Ken Burns — full example

A 0.73 s segment with a slow zoom-out from 1.5× to 1.0× (excerpt from `paranoia-spiral` segment `631a9e50-…`):

```jsonc
{
  "id": "631a9e50-...",
  "target_timerange": { "start": 0, "duration": 733333 },
  "clip": { "scale": { "x": 1.0, "y": 1.0 }, "rotation": 0,
            "transform": { "x": 0, "y": 0 }, "alpha": 1 },
  "common_keyframes": [
    {
      "id": "9f5c0a03-...", "material_id": "", "property_type": "KFTypeScaleX",
      "keyframe_list": [
        { "id": "57f34721-...", "curveType": "FreeCurveInOut",
          "time_offset": 0,
          "left_control":  { "x": 0.0,       "y": 0.0   },
          "right_control": { "x": 234667.0,  "y": -0.47 },
          "values": [ 1.5 ], "string_value": "", "graphID": "" },
        { "id": "1dbf81bb-...", "curveType": "FreeCurveInOut",
          "time_offset": 733333,
          "left_control":  { "x": -293333.0, "y": 0.0 },
          "right_control": { "x": 0.0,       "y": 0.0 },
          "values": [ 1.0 ], "string_value": "", "graphID": "<uuid>" }
      ]
    },
    {
      "id": "81e0e731-...", "material_id": "", "property_type": "KFTypeScaleY",
      "keyframe_list": [ /* mirror of ScaleX with identical times/values */ ]
    }
  ]
}
```

> ⚠ When `common_keyframes` is non-empty, the **static** values in `clip.scale` / `clip.transform` are **ignored at runtime** — the keyframe at `time_offset: 0` wins. Set `clip` to sensible defaults anyway so CapCut's editor UI shows correct values if the keyframes are deleted.

### cutcli → schema mapping

cutcli call:

```bash
cutcli keyframes add "$DRAFT_ID" --keyframes "[
  {\"segmentId\":\"$SEG_ID\",\"property\":\"scale_x\",\"offset\":0,\"value\":1.0},
  {\"segmentId\":\"$SEG_ID\",\"property\":\"scale_x\",\"offset\":5000000,\"value\":1.3},
  {\"segmentId\":\"$SEG_ID\",\"property\":\"scale_y\",\"offset\":0,\"value\":1.0},
  {\"segmentId\":\"$SEG_ID\",\"property\":\"scale_y\",\"offset\":5000000,\"value\":1.3}
]"
```

Resulting JSON patch on the matching segment (simplified):

```jsonc
"common_keyframes": [
  { "property_type": "KFTypeScaleX",
    "keyframe_list": [
      { "time_offset": 0,       "values": [1.0], "curveType": "FreeCurveInOut", /* … */ },
      { "time_offset": 5000000, "values": [1.3], "curveType": "FreeCurveInOut", /* … */ }
    ]
  },
  { "property_type": "KFTypeScaleY",
    "keyframe_list": [
      { "time_offset": 0,       "values": [1.0], "curveType": "FreeCurveInOut", /* … */ },
      { "time_offset": 5000000, "values": [1.3], "curveType": "FreeCurveInOut", /* … */ }
    ]
  }
]
```

### Helper API for `capcut-cli-david`

```ts
export type KFProperty =
  | "scale_x" | "scale_y"
  | "position_x" | "position_y"
  | "rotation" | "opacity";

export type KFCurve = "linear" | "ease_in" | "ease_out" | "ease_in_out";

export function addKeyframe(
  segment: Segment,
  prop: KFProperty,
  offsetUs: number,
  value: number,
  curve: KFCurve = "ease_in_out",
): void;

export function addKenBurns(
  segment: Segment,
  opts: { startScale: number; endScale: number; durationUs: number; curve?: KFCurve },
): void;
// → emits 4 keyframes (scale_x × 2, scale_y × 2)
```

---

## 3 · TypeScript — keyframes

```ts
export type KFType =
  | "KFTypeScaleX" | "KFTypeScaleY"
  | "KFTypePositionX" | "KFTypePositionY"
  | "KFTypeRotation" | "KFTypeAlpha";

export type CurveType = "Line" | "EaseIn" | "EaseOut" | "FreeCurveInOut";

export interface KeyframeGroup {
  id: string;
  material_id: "";              // always empty for clip transforms
  property_type: KFType;
  keyframe_list: Keyframe[];
}

export interface Keyframe {
  id: string;
  curveType: CurveType;
  time_offset: number;          // μs, relative to segment.target_timerange.start
  left_control:  { x: number; y: number };
  right_control: { x: number; y: number };
  values: number[];             // [scalar] for 1D properties; [x, y] for 2D
  string_value: "";
  graphID: string;              // UUID → keyframe_graph_list[].id when FreeCurveInOut; "" otherwise
}

export interface KeyframeGraphRef {
  id: string;
  resource_id: string;
  resource_name: string;        // e.g. "Cubic Out"
  source_platform: number;
  graph_points: unknown[];      // empty for catalogue refs
}

export interface LegacyKeyframesHolder {
  videos: unknown[];
  audios: unknown[];
  texts: unknown[];
  stickers: unknown[];
  filters: unknown[];
  adjusts: unknown[];
  handwrites: unknown[];
  effects: unknown[];
}
```

---

## 4 · `materials.material_animations[]` — text / sticker animations

Animations on **text and stickers** live in `materials.material_animations[]`. A segment links to its animation bundle via `extra_material_refs[0]` (single ID — text and sticker segments carry exactly one extra ref).

```jsonc
{
  "id": "be81454c-2bc6-4915-8aa7-34506eac32cc",
  "type": "sticker_animation",                  // same type for text AND sticker bundles
  "multi_language_current": "none",
  "animations": [
    {
      "id":            "6724916044072227332",   // CapCut catalog ID
      "type":          "in",                     // "in" | "out" | "loop"
      "start":         0,                        // μs (in: 0 from segment start; out: 0 — engine subtracts duration from end)
      "duration":      500000,                   // μs
      "path":          "C:/Users/.../Cache/effect/6724916044072227332/3ed09...",
      "platform":      "all",
      "resource_id":   "6724916044072227332",
      "third_resource_id": "6724916044072227332",
      "source_platform": 1,
      "name":          "Fade In",                // human-readable name
      "category_id":   "ruchang",                // "ruchang"=入场 (entrance), "chuchang"=exit, "xunhuan"=loop
      "category_name": "In",                     // "In" | "Out" | "Loop" | "Favorites"
      "panel":         "",
      "material_type": "sticker",                // "sticker" | "text" (misleading: "sticker" used for text bundles too)
      "anim_adjust_params": null,                // sometimes { "direction": "", "anim_mode": "all" }
      "request_id":    "20260506070257E0..."
    },
    {
      "id": "6887765964515971585",
      "type": "out",
      "start": 0,
      "duration": 300000,
      "name": "Bounce Out",
      "category_id": "chuchang_fav",
      "category_name": "Favorites",
      "material_type": "sticker",
      "anim_adjust_params": { "direction": "", "anim_mode": "all" }
      /* …same shape… */
    }
  ]
}
```

### Observed animations

| `name` | `category_name` (en / cn) | `type` |
|---|---|---|
| Fade In | In / 入场 | `in` |
| Bounce Out | Favorites | `out` |
| 渐隐 (Fade Out) | 出场 | `out` |

cutcli's `inAnimation: "渐显"` (Fade In) → one `animations[]` entry with `type: "in", name: "渐显"`. The `path`, `resource_id`, etc. come from CapCut's effect cache; cutcli resolves them through its `query text-animations` / `query image-animations` indices.

### Timing rules

- `start` is **relative to the segment's own timeline** (not the global timeline).
- For an **in** animation, `start: 0` plays it at segment start.
- For an **out** animation, CapCut still records `start: 0` — the engine subtracts `duration` from segment end internally. Don't try to "fix" the start to `segment.duration - duration`; that breaks playback.
- `inAnimationDuration + outAnimationDuration` MUST be `≤ segment.target_timerange.duration`, otherwise the animations collide and play at fractional speed.

### TypeScript

```ts
export type AnimationType = "in" | "out" | "loop";
export type AnimationMaterialType = "sticker" | "text";

export interface MaterialAnimation {
  id: string;
  type: "sticker_animation";          // for both text AND sticker bundles
  multi_language_current: "none" | string;
  animations: Animation[];
}

export interface Animation {
  id: string;
  type: AnimationType;
  start: number;                      // μs, segment-relative
  duration: number;                   // μs
  path: string;
  platform: "all" | string;
  resource_id: string;
  third_resource_id: string;
  source_platform: number;
  name: string;                       // human-readable
  category_id: string;                // "ruchang" | "chuchang" | "xunhuan" | "ruchang_fav" | "chuchang_fav" | ...
  category_name: "In" | "Out" | "Loop" | "Favorites" | string;
  panel: string;
  material_type: AnimationMaterialType;
  anim_adjust_params: { direction: string; anim_mode: string } | null;
  request_id: string;
}
```

---

## 5 · Rules summary

1. **Ken Burns = two containers.** Always emit `KFTypeScaleX` AND `KFTypeScaleY` together — same times, same values. One alone distorts.
2. **`time_offset` is segment-relative.** Range `0 … segment.target_timerange.duration`. Not global timeline.
3. **`FreeCurveInOut` requires a `keyframe_graph_list[]` entry.** Generate the UUID, append the entry, link from the keyframe's `graphID`. Other curve types use `graphID: ""` and no entry.
4. **`common_keyframes` overrides static `clip`.** Set the keyframe at `time_offset: 0` to your desired start value.
5. **Top-level `keyframes`** is a legacy 8-bucket holder, always empty in modern drafts — preserve verbatim, emit empty on create.
6. **Text & sticker animations** share the `"sticker_animation"` type and link via `extra_material_refs[0]`. The bundle may carry one `in`, one `out`, and one `loop` simultaneously. Sum of `in` + `out` durations ≤ segment duration.
