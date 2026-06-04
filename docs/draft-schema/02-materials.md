# 02 — Materials

`draft.materials` is a single dict containing **54 typed array slots**. Most are empty in any given draft. A segment references the actual asset via `segment.material_id` (and peripheral helpers via `extra_material_refs[]` — see `01-tracks-and-segments.md` §2.2).

This doc covers the "core" materials a port must read and write: videos, audios, texts (with the embedded styling JSON that powers keyword highlight), and the per-segment peripheral materials.

For stickers, transitions, masks, filters, and video_effects, see `04-effects-filters-stickers.md`.

---

## 1 · Slot catalogue

| Slot | Holds | Notes |
|---|---|---|
| `videos` | image + video clips | `type: "photo"` for images, `"video"` for video |
| `audios` | audio sources | mp3 / wav / etc. |
| `texts` | caption blocks | text + JSON-encoded styling |
| `canvases` | per-segment letterbox canvas | one per video segment |
| `speeds` | per-segment playback rate | one per video / audio segment |
| `placeholder_infos` | per-segment placeholder slot | always present |
| `sound_channel_mappings` | per-segment audio channels | always present |
| `material_colors` | per-segment color-clip backing | always present, mostly empty |
| `loudnesses` | per-segment auto-loudness state | always present in cutcli output |
| `vocal_separations` | per-segment vocal split state | always present |
| `material_animations` | text / sticker entrance-exit-loop bundles | shared by segments via ref |
| `video_effects` | global video effect (e.g. VHS Horror) | see `04-effects-filters-stickers.md` |
| `effects` | CapCut-UI filter (e.g. Vintage) | see `04-effects-filters-stickers.md` |
| `stickers` | sticker overlays | see `04-effects-filters-stickers.md` |
| `transitions` | inter-segment transitions | see `04-effects-filters-stickers.md` |
| `common_mask` | mask shapes (Circle, Linear, ...) | see `04-effects-filters-stickers.md` |

**Full slot list (54 keys, sorted):**

```
ai_translates, audio_balances, audio_effects, audio_fades, audio_pannings,
audio_pitch_shifts, audio_track_indexes, audios, beats, canvases, chromas,
color_curves, common_mask, digital_human_model_dressing, digital_humans, drafts,
effects, flowers, green_screens, handwrites, hsl, hsl_curves, images,
log_color_wheels, loudnesses, manual_beautys, manual_deformations,
material_animations, material_colors, multi_language_refs, placeholder_infos,
placeholders, plugin_effects, primary_color_wheels, realtime_denoises, shapes,
smart_crops, smart_relights, sound_channel_mappings, speeds, stickers,
tail_leaders, text_templates, texts, time_marks, transitions, video_effects,
video_radius, video_shadows, video_strokes, video_trackings, videos,
vocal_beautifys, vocal_separations
```

> ⚠ Slots not used by `capcut-cli-david` must still be **preserved verbatim** on round-trip — CapCut writes them and may read them back. Treat unknown slots as opaque arrays.

---

## 2 · `materials.videos[]` — image or video clip

```jsonc
{
  "id": "62842301-8666-4f71-9224-045d283d722d",   // → segment.material_id
  "type": "photo",                                  // "photo" (image) | "video"
  "duration": 5000000,                              // source duration μs (image: matches first usage)
  "path": "##_draftpath_placeholder_...##\\Resources\\459b78b5-....png",
  "width": 768, "height": 1376,                     // intrinsic resolution
  "media_path": "",
  "local_id": "",
  "has_audio": false,                               // true for video files with audio track
  "reverse_path": "", "intensifies_path": "",
  "reverse_intensifies_path": "", "intensifies_audio_path": "", "cartoon_path": "",
  "material_name": "2f44cb70-...",                  // internal alias

  "category_id": "", "category_name": "",
  "material_id": "", "material_url": "",

  /* Crop quad — normalised [0,1] corners. Default = full bounds. */
  "crop": {
    "upper_left_x": 0, "upper_left_y": 0,
    "upper_right_x": 1, "upper_right_y": 0,
    "lower_left_x": 0, "lower_left_y": 1,
    "lower_right_x": 1, "lower_right_y": 1
  },
  "crop_ratio": "free",
  "crop_scale": 1.0,

  "audio_fade": null,
  "extra_type_option": 0,
  "stable": { "stable_level": 0, "matrix_path": "",
              "time_range": { "start": 0, "duration": 5000000 } },
  "matting":  { "flag": 0, "path": "", "interactiveTime": [], "strokes": [],
                "has_use_quick_brush": false, "has_use_quick_eraser": false,
                "expansion": 0, "feather": 0, "reverse": false,
                "custom_matting_id": "", "enable_matting_stroke": false },

  "source": 0, "source_platform": 0,
  "formula_id": "", "check_flag": 63487,
  "video_algorithm": { /* ~25 empty-default sub-fields — preserve verbatim */ },
  "is_unified_beauty_mode": false,
  "object_locked": null, "smart_motion": null, "multi_camera_info": null, "freeze": null,
  "picture_from": "none", "picture_set_category_id": "", "picture_set_category_name": "",
  "team_id": "", "local_material_id": "", "origin_material_id": "", "request_id": "",
  "has_sound_separated": false, "is_text_edit_overdub": false,
  "is_ai_generate_content": false, "aigc_type": "none", "is_copyright": false,
  "aigc_history_id": "", "aigc_item_id": "", "local_material_from": "",
  "smart_match_info": null,
  "beauty_face_preset_infos": [], "beauty_body_preset_id": "",
  "beauty_face_auto_preset": { "preset_id": "", "name": "", "rate_map": "", "scene": "" },
  "beauty_face_auto_preset_infos": [], "beauty_body_auto_preset": null,
  "live_photo_timestamp": -1, "live_photo_cover_path": "",
  "content_feature_info": null, "corner_pin": null, "surface_trackings": [],

  "video_mask_stroke": { "resource_id": "", "path": "", "type": "", "color": "",
                         "size": 0, "alpha": 0, "distance": 0, "texture": 0,
                         "horizontal_shift": 0, "vertical_shift": 0 },
  "video_mask_shadow": { "resource_id": "", "path": "", "color": "",
                         "alpha": 0, "blur": 0, "distance": 0, "angle": 0 }
}
```

### TypeScript

```ts
export type VideoMaterialType = "photo" | "video";

export interface VideoMaterial {
  id: string;
  type: VideoMaterialType;
  duration: number;            // μs
  path: string;                // may contain ##_draftpath_placeholder_…##
  width: number;
  height: number;
  has_audio: boolean;
  material_name: string;
  crop: CropQuad;
  crop_ratio: "free" | string;
  crop_scale: number;
  matting: Matting;
  stable: { stable_level: number; matrix_path: string; time_range: Timerange };
  /* …~50 boilerplate fields — preserved verbatim, defaulted on create… */
}

export interface CropQuad {
  upper_left_x: number;  upper_left_y: number;
  upper_right_x: number; upper_right_y: number;
  lower_left_x: number;  lower_left_y: number;
  lower_right_x: number; lower_right_y: number;
}

export interface Matting {
  flag: number; path: string;
  interactiveTime: unknown[]; strokes: unknown[];
  has_use_quick_brush: boolean; has_use_quick_eraser: boolean;
  expansion: number; feather: number; reverse: boolean;
  custom_matting_id: string; enable_matting_stroke: boolean;
}
```

---

## 3 · `materials.audios[]` — audio source

```jsonc
{
  "id": "d6edf09f-cb0c-4831-b670-bbe7b9362636",
  "type": "extract_music",                            // "extract_music" | "music" | "voice"
  "name": "6d172b0f-...",                              // file basename / fingerprint
  "duration": 60033333,
  "path": "##_draftpath_placeholder_...##\\Resources\\d8fd3401-....mp3",
  "category_name": "local",
  "wave_points": [],                                   // pre-computed waveform peaks

  "music_id": "", "app_id": 0, "text_id": "", "tone_type": "",
  "video_id": "", "effect_id": "", "resource_id": "",
  "third_resource_id": "", "category_id": "", "intensifies_path": "",
  "formula_id": "", "check_flag": 1, "team_id": "", "local_material_id": "",

  /* TTS-related fields — empty for non-TTS audio */
  "tone_speaker": "", "mock_tone_speaker": "",
  "tone_effect_id": "", "tone_effect_name": "", "tone_platform": "",
  "cloned_model_type": "", "tone_category_id": "", "tone_category_name": "",
  "tone_second_category_id": "", "tone_second_category_name": "",
  "tone_emotion_name_key": "", "tone_emotion_style": "", "tone_emotion_role": "",
  "tone_emotion_selection": "", "tone_emotion_scale": 0.0,
  "moyin_emotion": "",

  /* Misc */
  "request_id": "", "query": "", "search_id": "",
  "sound_separate_type": "",
  "is_text_edit_overdub": false, "is_ugc": false,
  "is_ai_clone_tone": false, "is_ai_clone_tone_post": false,
  "source_from": "", "copyright_limit_type": "none",
  "aigc_history_id": "", "aigc_item_id": "",
  "music_source": "", "pgc_id": "", "pgc_name": "",
  "similiar_music_info": { "original_song_id": "", "original_song_name": "" },
  "ai_music_type": 0, "ai_music_enter_from": "",
  "lyric_type": 0,
  "tts_task_id": "", "tts_generate_scene": "",
  "ai_music_generate_scene": 0,
  "tts_benefit_info": { "benefit_type": "none", "benefit_log_id": "",
                        "benefit_log_extra": "", "benefit_amount": -1 }
}
```

### TypeScript

```ts
export type AudioMaterialType = "extract_music" | "music" | "voice";

export interface AudioMaterial {
  id: string;
  type: AudioMaterialType;
  name: string;
  duration: number;            // μs
  path: string;
  category_name: "local" | string;
  wave_points: number[];       // peaks; empty when not yet computed
  /* …large TTS / sourcing block — preserved verbatim, defaulted on create… */
}
```

---

## 4 · `materials.texts[]` — caption / subtitle

> **Critical:** the visible text and all styling live as a **JSON-encoded string inside `content`**. The outer scalar fields (`text_color`, `font_size`, `border_*`, `shadow_*`, …) are legacy mirrors — CapCut **renders from the embedded JSON**.

The full outer shape carries ~90 fields. They split into three groups: identity (`id`, `type`, `content`), legacy style mirror (kept in sync with the embedded JSON), and template/recognition state. The port should mutate both the embedded JSON **and** the mirrored outer fields on every write, to stay safe on older CapCut readers.

### 4.1 · Outer shape

```jsonc
{
  "id": "ea9db473-5d81-4e19-b9c7-7729de4ea1d6",
  "type": "subtitle",                       // "subtitle" | "text"
  "name": "",

  /* THE TEXT — embedded JSON string (see §4.2) */
  "content": "{\"text\":\"ET SI QUELQU'UN REGARDAIT ?\",\"styles\":[...]}",
  "base_content": "",

  /* Legacy / fallback styling mirror — CapCut still reads these */
  "text_color": "#ffffff", "text_alpha": 1.0, "text_size": 30,
  "font_name": "", "font_title": "CC-DerStil", "font_size": 11.0,
  "font_path": "C:/.../PlayfairDisplay-VariableFont_wght.ttf",
  "font_id": "", "font_resource_id": "", "font_url": "",
  "font_category_id": "", "font_category_name": "",
  "font_source_platform": 0, "font_third_resource_id": "", "font_team_id": "",
  "fonts": [], "initial_scale": 1.0,
  "alignment": 1,                            // 0=left 1=center 2=right
  "line_feed": 1,
  "letter_spacing": 0.0, "line_spacing": 0.02,
  "bold_width": 0.0, "italic_degree": 0,
  "underline": false, "underline_width": 0.05, "underline_offset": 0.22,
  "border_color": "#000000", "border_alpha": 1.0,
  "border_width": 0.0305, "border_mode": 0,
  "has_shadow": true, "shadow_color": "#000000",
  "shadow_alpha": 1.0, "shadow_smoothing": 1.2,
  "shadow_distance": 0.0, "shadow_angle": 0.0,
  "shadow_point": { "x": 0, "y": 0 },
  "shadow_thickness_projection_enable": false,
  "shadow_thickness_projection_angle": 0.0,
  "shadow_thickness_projection_distance": 0.0,
  "background_color": "", "background_alpha": 1.0,
  "background_style": 0, "background_round_radius": 0.0,
  "background_width": 0.14, "background_height": 0.14,
  "background_vertical_offset": 0, "background_horizontal_offset": 0,
  "background_fill": "",
  "single_char_bg_enable": false,
  "single_char_bg_color": "", "single_char_bg_alpha": 1.0,
  "single_char_bg_round_radius": 0.3,
  "single_char_bg_width": 0.0, "single_char_bg_height": 0.0,
  "single_char_bg_vertical_offset": 0.0, "single_char_bg_horizontal_offset": 0.0,

  /* Subtitle recognition (TTS / ASR) */
  "recognize_task_id": "", "recognize_text": "", "recognize_model": "",
  "punc_model": "",
  "words":         { "start_time": [], "end_time": [], "text": [] },
  "current_words": { "start_time": [], "end_time": [], "text": [] },

  /* Curved-text */
  "text_curve": null, "text_loop_on_path": false,
  "offset_on_path": 0.0, "enable_path_typesetting": false,
  "text_exceeds_path_process_type": 0,
  "text_typesetting_paths": null, "text_typesetting_paths_file": "",
  "text_typesetting_path_index": 0,
  "typesetting": 0,
  "shape_clip_x": false, "shape_clip_y": false,
  "fixed_width": -1.0, "fixed_height": -1.0,
  "line_max_width": 0.82, "oneline_cutoff": false, "cutoff_postfix": "",
  "inner_padding": -1.0,
  "force_apply_line_max_width": false,

  /* Animation / template references */
  "caption_template_info": { /* empty refs blob — used when applying a preset */ },
  "combo_info": { "text_templates": [] },
  "lyrics_template": { /* empty refs blob */ },
  "is_lyric_effect": false, "lyric_group_id": "",
  "subtitle_keywords": null, "subtitle_keywords_config": null,
  "subtitle_template_original_fontsize": 0.0,
  "is_batch_replace": false, "is_words_linear": false,
  "ssml_content": "", "sub_template_id": -1,
  "translate_original_text": "",
  "multi_language_current": "none", "language": "",
  "text_to_audio_ids": [], "tts_auto_update": false,
  "text_preset_resource_id": "", "preset_id": "", "preset_name": "",
  "preset_category": "", "preset_category_id": "", "preset_index": 0,
  "preset_has_set_alignment": false,
  "ktv_color": "", "use_effect_default_color": false,
  "is_rich_text": true,
  "global_alpha": 1.0, "layer_weight": 1,
  "group_id": "", "style_name": "",
  "add_type": 0, "operation_type": 0,
  "recognize_type": 0, "sub_type": 0,
  "check_flag": 47,
  "source_from": "",
  "original_size": [], "relevance_segment": []
}
```

### 4.2 · Embedded `content` JSON

```jsonc
{
  "text": "ET SI QUELQU'UN REGARDAIT ?",
  "styles": [
    {
      "range": [0, 27],                          // [start, end) char range
      "size": 11,
      "bold": true,
      "fill":  { "content": { "render_type": "solid",
                              "solid": { "color": [1, 1, 1] } } },
      "font":  { "path": "C:/.../PlayfairDisplay-VariableFont_wght.ttf", "id": "" },
      "strokes": [ { "content": { "render_type": "solid",
                                  "solid": { "color": [0, 0, 0] } },
                     "width": 0.0305, "mode": 0 } ],
      "shadows": [ { "distance": 0, "angle": 0, "diffuse": 0.0667,
                     "content": { "render_type": "solid",
                                  "solid": { "color": [0, 0, 0] } },
                     "thickness_projection_angle": -45,
                     "thickness_projection_enable": false,
                     "thickness_projection_distance": 0 } ]
    }
  ]
}
```

### 4.3 · Keyword highlight — N consecutive ranges

Multiple style blocks with **non-overlapping, contiguous** `range` arrays produce keyword highlight. From the `fixture-anim-kw` CapCut-UI capture (mid-word color change on `"THE EYES ARE WATCHING ME."`):

```jsonc
"styles": [
  { "range": [0, 13],  "fill": { "content": { "solid": { "color": [1.0,   1.0,   1.0] } } }, ...  },  // before
  { "range": [13, 21], "fill": { "content": { "solid": { "color": [0.549, 0.423, 1.0] } } }, ...  },  // KEYWORD (purple)
  { "range": [21, 25], "fill": { "content": { "solid": { "color": [1.0,   1.0,   1.0] } } }, ...  }   // after
]
```

**Rules:**
- Ranges are `[start, end)` half-open over the `text` field's UTF-16 code units.
- Ranges MUST be contiguous and non-overlapping. The sum of all range lengths = full text length.
- Each style entry must carry the **full styling block** (`fill`, `font`, `strokes`, `shadows`, `size`, `bold`, ...). Partial inheritance is NOT supported; missing fields fall back to the segment's outer text-material fields.
- For a single-color caption use one style with `range: [0, len]`.

cutcli's `keyword` / `keywordColor` params compile to **2 styles** (before-keyword + keyword) when the keyword sits at the start, or **3 styles** when the keyword is mid-text. The pattern auto-extends to N consecutive ranges if needed.

**Implemented (v1.4.0).** `capcut-david add-text --keyword <word>|--keyword-range <s,e> [--keyword-color <hex>]` and `capcut-david import-captions <project> <captions.json>` produce this encoding via the shared `buildRichTextContent()` helper. Notes from reverse-engineering + a live CapCut render:
- `range` offsets are **UTF-16 code units** (JS `String.length`/`indexOf`), matching this section — **not** the UTF-16 *byte* length the legacy single-span `buildTextContent` writes for non-highlighted text (that path is frozen for byte-identity).
- Colors are emitted as **float32** (`Math.fround(n/255)`) to match CapCut's native floats (e.g. `#8C6CFF → [0.5490196347236633, …]`).
- The engine writes a lean per-span block (`fill` + `size` + `range`) + `is_rich_text: true`; `useLetterColor` (seen on UI captures) is **UI state, not required for rendering** — confirmed by a live CapCut render of engine output.

### 4.4 · TypeScript

```ts
export interface TextMaterial {
  id: string;
  type: "subtitle" | "text";
  name: string;

  /** JSON-encoded `EmbeddedTextContent` — render source of truth */
  content: string;
  base_content: string;

  /* Legacy style mirror — keep in sync with the embedded content for older readers */
  text_color: string;
  text_alpha: number;
  text_size: number;
  font_title: string;
  font_size: number;
  font_path: string;
  alignment: 0 | 1 | 2;
  /* …~80 more legacy mirror + recognition + template fields… */
}

export interface EmbeddedTextContent {
  text: string;
  styles: TextStyleRange[];
}

export interface TextStyleRange {
  range: [number, number];     // [start, end) — UTF-16 code units
  size: number;
  bold: boolean;
  fill: { content: { render_type: "solid"; solid: { color: [number, number, number] } } };
  font: { path: string; id: string };
  strokes: TextStroke[];
  shadows: TextShadow[];
}

export interface TextStroke {
  content: { render_type: "solid"; solid: { color: [number, number, number] } };
  width: number;
  mode: number;
}

export interface TextShadow {
  distance: number;
  angle: number;
  diffuse: number;
  content: { render_type: "solid"; solid: { color: [number, number, number] } };
  thickness_projection_angle: number;
  thickness_projection_enable: boolean;
  thickness_projection_distance: number;
}
```

---

## 5 · Peripheral / boilerplate materials

These are always present (one per segment) but rarely customised. Default-shaped entries below are sufficient. **Use a fresh UUID for each entry — never reuse across segments.**

```jsonc
// canvases[] — letterbox / background fill behind the clip
{ "id": "...", "type": "canvas_color", "color": "", "blur": 0.0,
  "image": "", "album_image": "", "image_id": "", "image_name": "",
  "source_platform": 0, "team_id": "" }

// speeds[] — playback rate; curve_speed is for ramped speed
{ "id": "...", "type": "speed", "mode": 0, "speed": 1.0, "curve_speed": null }

// placeholder_infos[]
{ "id": "...", "type": "placeholder_info", "meta_type": "none",
  "res_path": "", "res_text": "", "error_path": "", "error_text": "" }

// sound_channel_mappings[]
{ "id": "...", "type": "none", "audio_channel_mapping": 0, "is_config_open": false }

// material_colors[] — solid color clip backing; only populated for color-fill clips
{ "id": "...", "is_color_clip": false, "is_gradient": false,
  "solid_color": "", "gradient_colors": [], "gradient_percents": [],
  "gradient_angle": 90.0, "width": 0.0, "height": 0.0 }

// loudnesses[]
{ "id": "...", "enable": false, "time_range": null, "file_id": "",
  "target_loudness": 0.0, "loudness_param": null }

// vocal_separations[]
{ "id": "...", "type": "vocal_separation", "choice": 0, "removed_sounds": [],
  "time_range": null, "production_path": "", "final_algorithm": "", "enter_from": "" }
```

### TypeScript

```ts
export interface Canvas {
  id: string;
  type: "canvas_color" | string;
  color: string;
  blur: number;
  image: string;
  album_image: string;
  image_id: string;
  image_name: string;
  source_platform: number;
  team_id: string;
}

export interface Speed {
  id: string;
  type: "speed";
  mode: number;
  speed: number;
  curve_speed: null | unknown;
}

export interface PlaceholderInfo {
  id: string;
  type: "placeholder_info";
  meta_type: "none" | string;
  res_path: string;
  res_text: string;
  error_path: string;
  error_text: string;
}

export interface SoundChannelMapping {
  id: string;
  type: "none" | string;
  audio_channel_mapping: number;
  is_config_open: boolean;
}

export interface MaterialColor {
  id: string;
  is_color_clip: boolean;
  is_gradient: boolean;
  solid_color: string;
  gradient_colors: string[];
  gradient_percents: number[];
  gradient_angle: number;
  width: number;
  height: number;
}

export interface Loudness {
  id: string;
  enable: boolean;
  time_range: Timerange | null;
  file_id: string;
  target_loudness: number;
  loudness_param: null | unknown;
}

export interface VocalSeparation {
  id: string;
  type: "vocal_separation";
  choice: number;
  removed_sounds: unknown[];
  time_range: Timerange | null;
  production_path: string;
  final_algorithm: string;
  enter_from: string;
}
```

---

## 6 · Materials surface

```ts
export interface Materials {
  // core
  videos: VideoMaterial[];
  audios: AudioMaterial[];
  texts: TextMaterial[];

  // peripherals (one entry per segment)
  canvases: Canvas[];
  speeds: Speed[];
  placeholder_infos: PlaceholderInfo[];
  sound_channel_mappings: SoundChannelMapping[];
  material_colors: MaterialColor[];
  loudnesses: Loudness[];
  vocal_separations: VocalSeparation[];

  // text + sticker animations
  material_animations: MaterialAnimation[];        // see 03-keyframes-and-animations §5

  // features (see 04-effects-filters-stickers)
  video_effects: VideoEffect[];                    // cutcli + CapCut "Effects" panel
  effects: FilterMaterial[];                       // CapCut UI "Filters" panel
  stickers: StickerMaterial[];
  transitions: Transition[];
  common_mask: Mask[];

  // ~40 other slots — opaque, preserved verbatim
  [otherSlot: string]: unknown;
}
```

---

## 7 · Rules summary

1. **One material per segment** for `videos` / `audios` / `texts` — never reuse a material across multiple segments. If two segments need the same media, emit two `videos[]` entries with separate UUIDs (same `path`).
2. **One peripheral per segment** for canvases, speeds, placeholders, sound channels, material colors, loudnesses, vocal separations. Fresh UUIDs each time.
3. **Text styling is dual-encoded** — write the embedded `content` JSON AND keep the legacy outer mirror fields in sync.
4. **Keyword highlight** = N consecutive non-overlapping ranges, each with the full styling block.
5. **Preserve unknown slots** verbatim on round-trip.
