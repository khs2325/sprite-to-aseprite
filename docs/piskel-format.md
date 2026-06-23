# Supported Piskel subset

This note defines the `.piskel` subset implemented by the browser-only Piskel
importer. User artwork remains browser-local and is never uploaded for
conversion. The converter preserves layers only when the supported `.piskel`
source contains layer data; it does not infer or invent layers.

## Accepted document shape

The file must be UTF-8 JSON with this model-version-2 shape:

```json
{
  "modelVersion": 2,
  "piskel": {
    "name": "Project name",
    "description": "Optional description",
    "fps": 12,
    "height": 16,
    "width": 16,
    "layers": ["{\"name\":\"Layer 1\",...}"],
    "hiddenFrames": []
  }
}
```

- `modelVersion` is required and must be the integer `2`. Versions `0`, `1`,
  missing versions, and other values are rejected.
- `piskel` is required and must be an object. Its required fields are `name`,
  `fps`, `height`, `width`, and `layers`. `description` is an optional string.
  The optional boolean `expanded` field is harmless Piskel editor UI state and
  is ignored.
  `hiddenFrames` may be absent or an empty array; a non-empty value is rejected
  because `SpriteProject` has no matching hidden-frame state.
- `name` must be a non-empty string. It is project metadata and does not create
  a layer. `description`, when present, is metadata only.
- `width` and `height` must each be integers from `1` through `1024` inclusive.
- `fps` is one finite number greater than zero for the whole project. Piskel has
  no per-frame durations in this subset.
- `layers` must be a non-empty array. Every entry must be a JSON string whose
  decoded value is a layer record; direct object entries are rejected. Array
  order is source layer order and is copied unchanged to `SpriteProject`.
- Other unknown fields at the outer, `piskel`, layer, and chunk levels are
  rejected with the field name so unsupported variants do not lose metadata
  silently.

## Layer records

Each string in `piskel.layers` must decode to exactly this shape:

```json
{
  "name": "Ink",
  "opacity": 1,
  "frameCount": 2,
  "chunks": [
    {
      "layout": [[0], [1]],
      "base64PNG": "data:image/png;base64,..."
    }
  ]
}
```

- `name` is required, non-empty, and preserved exactly.
- `opacity`, when present, must be a finite number from `0` through `1`.
  Missing opacity defaults to `1`, matching Piskel's normal layer default.
  Conversion to the integer `SpriteLayer.opacity` is
  `Math.round(opacity * 255)`.
- Optional `visible`, when present, must be boolean. When absent, the layer is
  visible. This default fills the required `SpriteProject` property; it does
  not create a source layer.
- `frameCount` is a positive integer. Every layer must have the same
  `frameCount`, which becomes the project timeline length.
- A layer must contain either a non-empty `chunks` array or the legacy Piskel
  form with one top-level `base64PNG`, but never both. The legacy form is
  normalized to one horizontal sheet whose frames are ordered from `0` through
  `frameCount - 1`, matching Piskel's own compatibility behavior. An ambiguous
  record containing both forms is rejected.

Layer ids are generated deterministically as `piskel-layer-0`,
`piskel-layer-1`, and so on. No source layers are merged, split, or synthesized.

## Chunk layout and PNG data

Each chunk has exactly `layout` and `base64PNG` fields. `layout` is a non-empty,
rectangular array addressed as `layout[column][row]`; every cell is a
zero-based frame index. Across all chunks in one layer, the indexes must cover
every integer from `0` through `frameCount - 1` exactly once. Gaps, duplicates,
negative indexes, ragged layouts, and out-of-range indexes are rejected.

`base64PNG` must use the exact `data:image/png;base64,` prefix, strict base64,
and valid PNG bytes. After decoding, a chunk image must be exactly
`width * layout.length` pixels wide and
`height * layout[0].length` pixels high. The frame at `layout[x][y]` is the
`width` by `height` rectangle beginning at `(x * width, y * height)`. A decode
failure or dimension mismatch rejects the document.

## SpriteProject mapping

Frames are zero-based and ordered. The global Piskel FPS maps to the same whole
millisecond duration for every frame:

```text
durationMs = clamp(Math.round(1000 / fps), 1, 65535)
```

The bounds match the positive unsigned 16-bit duration supported by the
Aseprite exporter. Each Piskel layer becomes one `SpriteLayer` at the same
array position. Each decoded frame becomes a full-canvas cel at `(0, 0)` with
RGBA `ImageData`; transparent frames remain transparent cels.

The parser must reject malformed JSON, wrong types, unsupported versions,
unsupported legacy layers, inconsistent layer frame counts, invalid layouts,
invalid PNG data URLs, and decoded size mismatches with a specific error. It
must not silently skip bad layers, chunks, or frames.

## Preserved, defaulted, and unsupported data

For the supported subset, source layer names and array order, opacity,
explicit visibility, frame indexes, global-FPS timing, transparency, and
decoded RGBA pixels are mapped to the generated Aseprite file. Opacity is
quantized to the Aseprite-compatible integer range from `0` through `255`, so
this is not a claim of universal or lossless Piskel conversion.

The following values are defaulted or generated because `SpriteProject` needs
them: missing layer `visible` becomes `true`; layer ids become
`piskel-layer-0`, `piskel-layer-1`, and so on; and every full-canvas cel is
placed at `(0, 0)`. The Piskel project `name` and optional `description` are
validated but are not represented in the output. Per-frame durations are not
accepted; every frame receives the duration derived from the one project FPS.

Unsupported model versions, unknown fields other than the documented
`expanded` state, non-empty `hiddenFrames`, ambiguous layer image layouts,
external image URLs, incomplete or ambiguous frame coverage, and invalid PNG
data are rejected. Features outside the accepted document fields are not
silently defaulted or advertised as preserved.

## Validation diagnostics

The browser reports the importer-authored reason without displaying source
JSON, embedded pixel data, or a stack trace. Common messages identify invalid
outer JSON, an unsupported `modelVersion`, a missing required `piskel` field,
invalid dimensions or FPS, unsupported hidden frames, invalid string-encoded
layer JSON, missing or ambiguous layer image data, invalid chunk layout or
frame coverage, invalid PNG data URLs, embedded PNG dimension mismatches, and
browser image decode failures.

These messages describe the first detected structural problem. Correcting one
problem may reveal another; validation remains strict where accepting ambiguous
data could change layer or frame output.
