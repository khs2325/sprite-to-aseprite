# Supported Piskel subset

This note defines the `.piskel` subset for the planned browser-only Piskel
importer. It is a parser contract, not an importer implementation. User artwork
must remain browser-local and must never be uploaded for conversion. The
converter will preserve layers only when the `.piskel` source contains layer
data; it will not infer or invent layers.

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
- Unknown fields at the outer, `piskel`, layer, and chunk levels are rejected so
  unsupported variants do not lose metadata silently.

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
- `opacity` is required and must be a finite number from `0` through `1`.
  Conversion to the integer `SpriteLayer.opacity` is
  `Math.round(opacity * 255)`.
- Optional `visible`, when present, must be boolean. When absent, the layer is
  visible. This default fills the required `SpriteProject` property; it does
  not create a source layer.
- `frameCount` is a positive integer. Every layer must have the same
  `frameCount`, which becomes the project timeline length.
- `chunks` is a required, non-empty array. The legacy layer form containing one
  top-level `base64PNG` and no `chunks` is intentionally rejected, even though
  Piskel itself has historically normalized it. This first subset has one
  unambiguous image layout path.

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
