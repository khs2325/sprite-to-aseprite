# Spritesheet Output Planning

Status: planning only. Do not implement spritesheet export, trimming,
rotation, packing, or UI controls from this note alone.

Spritesheet output is a future browser-local exporter that consumes
`SpriteProject` and creates local downloads. It is intended for imported
Aseprite timelines and any other supported input that has already been
normalized into the shared model. It must not upload artwork or inspect raw
source parser state.

## First Exporter Subset

The first subset should export two files:

- `name.png`: one flattened RGBA spritesheet.
- `name.json`: one metadata sidecar describing frame rectangles, durations, and
  layout.

The exporter should be deliberately small:

- Fixed-size grid cells only.
- One sheet image only.
- Row-major frame placement.
- No trimming.
- No rotation.
- No atlas packing.
- No per-layer sheets.
- No claim of lossless conversion or recovery of source editor data.

## Frame Rendering

Each output frame is composited into a transparent `project.width` by
`project.height` canvas before being copied into the sheet. Visible layers are
drawn in project layer order using their opacity and cel offsets. Hidden layers
are ignored. Pixels outside the project canvas are clipped.

The first subset should reject invalid projects instead of guessing:

- Frame indices must be deterministic and unique.
- Frame durations must be finite non-negative millisecond values.
- The project must use RGBA color mode.
- The project must contain at least one frame.
- The project dimensions must be positive integers.

## Grid Layout

Frames are placed in timeline order from left to right, then top to bottom.
Timeline order is the validated `SpriteProject.frames` order; if the
implementation later requires contiguous numeric indices, that must be enforced
before export.

Without UI controls, the first subset should use a deterministic automatic
layout:

```text
columns = ceil(sqrt(frameCount))
rows = ceil(frameCount / columns)
sheetWidth = columns * project.width
sheetHeight = rows * project.height
```

Unused cells in the last row remain fully transparent and are not listed as
frames in JSON. Later work can add explicit columns, max-width constraints, or
multi-sheet output after those behaviors are specified and tested.

## Transparency

The PNG stores straight RGBA pixels with alpha preserved from the flattened
frame compositor. The exporter should not add a matte color, checkerboard
background, or opaque fill. Fully transparent padding from unused grid cells
must remain transparent.

## JSON Metadata

The sidecar JSON should use a small app-owned schema rather than pretending to
be TexturePacker or Aseprite JSON. A first version can look like:

```json
{
  "schema": "sprite-to-aseprite.spritesheet.v1",
  "image": "name.png",
  "size": { "w": 512, "h": 256 },
  "cell": { "w": 64, "h": 64 },
  "layout": { "columns": 8, "rows": 4, "order": "row-major" },
  "frames": [
    {
      "index": 0,
      "durationMs": 100,
      "frame": { "x": 0, "y": 0, "w": 64, "h": 64 },
      "sourceSize": { "w": 64, "h": 64 },
      "trimmed": false,
      "rotated": false
    }
  ]
}
```

`durationMs` is copied from each `SpriteFrame` so animation timing can be
reconstructed by consumers that read the sidecar. Frame rectangle width and
height match the fixed cell size in the first subset.

## Limitations

Spritesheet output exports flattened frame pixels and timing metadata. It does
not preserve editable layer structure in the PNG or JSON. Layers can only be
preserved by source formats and output formats that both contain layer data and
have explicit model and exporter support.

Frame tags are not part of the first spritesheet subset. If a future
`SpriteProject` tag model is available, a later schema version may add tag
ranges, names, directions, and color metadata. Until then, tags from imported
Aseprite files should be reported as not preserved by this exporter.

Source-specific metadata is not round-tripped. Aseprite chunks, writer version,
UUIDs, slices, palettes, color profiles, tilemaps, linked-cel relationships,
user properties, and raw chunk ordering are outside this output plan unless a
future task adds tested fields to the shared model and schema.
