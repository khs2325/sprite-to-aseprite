# Pixelorama `.pxo` Format Notes

Status: researched and fixture-backed importer subset. No Pixelorama importer or
UI wiring is implemented yet.

Primary references:

- Pixelorama official source repository: https://github.com/Orama-Interactive/Pixelorama
- Current `.pxo` open/save flow: https://raw.githubusercontent.com/Orama-Interactive/Pixelorama/master/src/Autoload/OpenSave.gd
- Project serialization and image-data loading: https://raw.githubusercontent.com/Orama-Interactive/Pixelorama/master/src/Classes/Project.gd
- Layer serialization and blend-mode enum: https://raw.githubusercontent.com/Orama-Interactive/Pixelorama/master/src/Classes/Layers/BaseLayer.gd
- Frame duration model: https://raw.githubusercontent.com/Orama-Interactive/Pixelorama/master/src/Classes/Frame.gd
- Layer type enum: https://raw.githubusercontent.com/Orama-Interactive/Pixelorama/master/src/Autoload/Global.gd

Pixelorama is open-source, but `.pxo` is an application project format rather
than a small interchange spec. The importer must only accept the documented
subset below. It must reject unsupported project features instead of guessing
their meaning or silently flattening them away.

## Container And Version

Current Pixelorama saves `.pxo` as a ZIP archive. The initial importer subset
accepts only this ZIP form. Legacy pre-1.0 files opened through Pixelorama's
old compressed/raw path are out of scope until separately researched and
fixture-backed.

Required ZIP entries:

- `data.json`: UTF-8 JSON from `Project.serialize()`.
- `mimetype`: exact UTF-8 text `application/x-pixelorama`.
- `image_data/frames/{frame}/layer_{layer}`: raw pixel cel bytes for every
  supported pixel layer cel. Both indexes are 1-based in the ZIP path.

Optional entries that are not source layer data:

- `preview.png`: thumbnail generated from the current frame. Ignore it for
  conversion.
- `image_data/final_images/{frame}`: optional blended previews. Never use these
  to recover layers.
- `image_data/frames/{frame}/indices_layer_{layer}`: indexed-mode side data.
  Ignore it for RGBA files; reject indexed projects rather than consuming it.

The safe subset fixtures use `pxo_version: 6`, `pixelorama_version: "1.1.10"`,
and `color_mode: 5`, which is Godot `Image.FORMAT_RGBA8`. The importer should
accept only `pxo_version` 6 and `color_mode` 5 until more versions are
researched with fixtures. `pixelorama_version` is informational metadata and
must be a non-empty string, but it is not enough to infer compatibility.

## Accepted `data.json` Shape

The supported project object must contain:

- `size_x` and `size_y`: integer canvas dimensions from `1` through `1024`.
- `fps`: one finite number greater than zero.
- `frames`: a non-empty array of frame records.
- `layers`: a non-empty array of layer records.
- Empty/default project metadata fields: `metadata: {}`, `license: ""`,
  `user_data: ""`, empty author fields, empty `tags`, `guides`, `brushes`,
  `palettes`, `reference_images`, `tilesets`, and `vanishing_points`.

Other Pixelorama export/editor fields such as current frame, current layer,
tile-mode bases, export path, export file name, export format, and symmetry
points are UI or export state for this converter. They may be validated for
basic type safety, but they do not map to `SpriteProject`.

Unknown top-level fields should be rejected with the field name. Non-empty
metadata or unsupported feature arrays should be rejected because the current
`SpriteProject` model has nowhere to preserve them.

## Layers

Only direct pixel layers are accepted:

```json
{
  "name": "Ink",
  "visible": true,
  "locked": false,
  "blend_mode": 0,
  "clipping_mask": false,
  "opacity": 1,
  "ui_color": "(0, 0, 0, 0)",
  "parent": -1,
  "effects": [],
  "type": 0,
  "new_cels_linked": false,
  "metadata": {}
}
```

Mapping:

- `type` must be `0` (`Global.LayerTypes.PIXEL`).
- `name` must be a non-empty string and maps to `SpriteLayer.name`.
- `visible` must be boolean and maps to `SpriteLayer.visible`.
- `opacity` must be finite from `0` through `1` and maps to
  `SpriteLayer.opacity = Math.round(opacity * 255)`.
- Layer ids are generated deterministically as `pixelorama-layer-0`,
  `pixelorama-layer-1`, and so on.
- Layer array order is preserved. Each frame's `cels[layerIndex]` belongs to
  `layers[layerIndex]`.

Required rejections:

- `type` other than `0`: group (`1`), 3D (`2`), tilemap (`3`), audio (`4`), or
  any unknown type.
- `blend_mode` other than `0` (`NORMAL`).
- `clipping_mask: true`, `parent` other than `-1`, or any layer hierarchy.
- Non-empty `effects` or any effect-like metadata.
- `link_sets`, linked cels, non-empty layer `metadata`, or non-empty
  `user_data`.
- Missing or invalid layer names, visibility, or opacity.

`locked`, `ui_color`, and `new_cels_linked` are editor state. They may be
validated as the expected types, then ignored.

## Frames And Cels

Each frame record contains one cel record per layer:

```json
{
  "cels": [
    { "opacity": 1, "z_index": 0, "ui_color": "(0, 0, 0, 0)", "metadata": {} }
  ],
  "duration": 1,
  "metadata": {}
}
```

- `frames.length` becomes the timeline length.
- `duration` is Pixelorama's frame duration multiplier. The Aseprite-bound
  duration is:

```text
durationMs = clamp(Math.round((duration * 1000) / fps), 1, 65535)
```

- Every frame must have exactly `layers.length` cels.
- Cel `opacity` must be `1` and `z_index` must be `0`; `SpriteProject` has no
  per-cel opacity or z-index field.
- Cel `metadata` and frame `metadata` must be empty. Frame or cel `user_data`
  must be absent or empty.
- Every supported cel maps to a full-canvas `SpriteCel` at `(0, 0)`.

## Raw Image Data

For frame index `f` and layer index `l`, both zero-based in `SpriteProject`,
the `.pxo` ZIP entry is:

```text
image_data/frames/{f + 1}/layer_{l + 1}
```

The entry payload is not PNG. It is raw RGBA8 bytes from Godot
`Image.get_data()` for a full-canvas image. The expected length is exactly:

```text
size_x * size_y * 4
```

Bytes are row-major RGBA. The first four bytes are pixel `(0, 0)`, followed by
`(1, 0)`, continuing across rows. Missing entries, wrong byte lengths, unsafe
paths, duplicate logical cel paths, or data for unsupported layer types must
reject the whole file.

Indexed projects are not in the safe subset. Reject `color_mode: -1`, palettes
needed for indexed mode, or any project where `indices_layer_*` data is needed
to interpret pixels.

## SpriteProject Mapping

Accepted `.pxo` data maps to:

```ts
{
  width: size_x,
  height: size_y,
  colorMode: "rgba",
  frames: data.frames.map((frame, index) => ({ index, durationMs })),
  layers: data.layers.map((layer, layerIndex) => ({
    id: `pixelorama-layer-${layerIndex}`,
    name: layer.name,
    visible: layer.visible,
    opacity: Math.round(layer.opacity * 255),
    cels: frames.map((frame, frameIndex) => ({
      frameIndex,
      x: 0,
      y: 0,
      imageData: rawRgbaCelBytes,
    })),
  })),
}
```

This can preserve layers when the `.pxo` source contains supported pixel layer
data. It does not claim lossless Pixelorama conversion, recover layers from a
preview, preserve tilemaps/effects/groups/3D/audio, or preserve arbitrary
project metadata.

## Unsupported Features

Reject clearly when any of these are present:

- Tilemap layers, tile sets, tile masks, or tilemap cel data.
- Group, 3D, audio, or unknown layer types.
- Layer effects, clipping masks, parented layers, linked cels, cel z-index, or
  per-cel opacity.
- Unsupported blend modes, including valid Pixelorama modes such as erase,
  multiply, screen, overlay, hue, saturation, color, luminosity, intersection,
  and match-colors.
- Indexed color mode, palettes required for pixel interpretation, or missing
  RGBA image data.
- Animation tags, guides, reference images, brushes, audio entries, scene
  entries, non-empty author/license/user data, or non-empty `metadata`.
- Ambiguous JSON values, duplicate frame/layer paths, duplicate keys if the
  parser can detect them, unsafe ZIP paths, encrypted ZIP entries, unsupported
  compression methods, or malformed archives.

The diagnostic should name the first unsupported feature and should not display
source artwork bytes or stack traces.

## Browser Validation Limits

Parsing must remain browser-local. Do not upload `.pxo` files or extracted user
artwork.

Recommended initial limits before allocation:

- ZIP file size: 25 MiB.
- `data.json` uncompressed size: 5 MiB.
- Total uncompressed ZIP bytes read: 64 MiB.
- ZIP entry count: 512.
- Canvas width and height: `1..1024`.
- Frames: `1..512`.
- Layers: `1..64`.
- Cels: `frames * layers <= 4096`.
- Total accepted raw RGBA cel bytes:
  `size_x * size_y * 4 * frames * pixelLayers <= 64 MiB`.
- Layer names and string metadata fields: 1024 UTF-16 code units each.

Validate all dimensions, counts, and multiplication with safe integers before
allocating `ArrayBuffer`, `Uint8Array`, `ImageData`, or decompressed ZIP entry
buffers. Reject path traversal (`..`), absolute paths, backslashes, directories
where a file is required, duplicate required entries, and entries whose names
normalize to the same logical path.

## Fixtures

Fixtures are generated by `tests/fixtures/generate.mjs` and contain only local,
synthetic pixels:

- `tests/fixtures/pixelorama/two-layers-two-frames.pxo` is the positive
  fixture. It covers ZIP structure, `mimetype`, `data.json`, two pixel layers,
  source layer order, names, visibility, opacity, two frame duration
  multipliers, raw RGBA cel data, and ignorable RGBA `indices_layer_*` entries.
- `tests/fixtures/pixelorama/unsupported-blend-mode.pxo` changes one layer to
  a non-normal blend mode for rejection coverage.
- `tests/fixtures/pixelorama/unsupported-effects.pxo` adds a non-empty layer
  effects array for rejection coverage.
- `tests/fixtures/pixelorama/unsupported-tilemap-layer.pxo` uses layer type
  `3` and a `tilesets/` entry for tilemap rejection coverage.
- `tests/fixtures/pixelorama/missing-image-data.pxo` omits the required raw
  cel image payload.
- `tests/fixtures/pixelorama/ambiguous-metadata.pxo` includes non-empty project
  metadata that must be rejected until a metadata mapping exists.

Fixture tests inspect the archive and payload structure. They do not implement
Pixelorama conversion.
