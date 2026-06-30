# Bidirectional Conversion Planning

Status: planning only. Do not add Aseprite input, new exporters, or UI controls
from this note alone.

Bidirectional conversion means the app can eventually import from and export to
multiple sprite formats through the shared `SpriteProject` model. It does not
mean byte-for-byte round trips or full editor feature preservation.

## Boundary

All importers, including any future `.ase` or `.aseprite` reader, must decode
browser-selected files locally and produce `SpriteProject`. All exporters must
consume `SpriteProject` and create local `Blob` downloads. Importers must not
hand raw source chunks directly to exporters, and exporters must not inspect UI
file objects or source-format parser state.

For Aseprite input, the feasible path is:

```text
.ase/.aseprite bytes
  -> bounded Aseprite reader
  -> validated SpriteProject
  -> selected exporter
  -> local download
```

## Output Needs From Aseprite Input

Future output paths should be enabled only when their required `SpriteProject`
semantics are present and tested.

| Output path | Needs from imported Aseprite data | Notes |
| --- | --- | --- |
| Aseprite `.aseprite` | Canvas, ordered frames, durations, supported tags, normal layers, layer visibility/opacity, cel offsets, RGBA pixels | Generates a new file through the existing exporter subset; unsupported source chunks are not round-tripped. |
| PNG sequence | A tested flattened frame compositor, frame order, canvas size, visible layer compositing, cel offsets | Exports pixels only; layer names, palettes, and editor metadata are not preserved. Timing and supported tags may be written only to an optional manifest as planned in [png-sequence-output.md](png-sequence-output.md). |
| Spritesheet PNG + JSON | Same flattened compositor plus deterministic sheet layout and max-canvas limits | Exports pixels and timing metadata only. The planned first subset is fixed-grid and row-major as documented in [spritesheet-output.md](spritesheet-output.md). |
| GIF/APNG | Flattened frames, timing conversion rules, transparency/disposal limits, encoder-specific validation | Animated outputs cannot preserve Aseprite layer structure. |
| Layered future outputs | Layer order, names, visibility, opacity, cel offsets, frame coverage, and format-specific limits | Groups, blend modes, masks, slices, palettes, and color profiles need separate model/exporter scope before preservation is claimed. |

## Loss Boundaries

Round-trip conversion can be lossy because `SpriteProject` stores normalized
sprite semantics, not the original Aseprite chunk graph. The current model can
represent RGBA frames, optional frame tags, normal layers, layer opacity, cel
offsets, and decoded cel pixels. It does not represent raw chunk ordering,
writer version, UUIDs, external files, user properties, layer groups, non-normal
blend modes, linked-cel editing relationships, per-cel opacity, cel z-index,
tilemaps, tilesets, masks, slices, palette identity, or color-profile data.

If a future task needs any of those features, it must update the reader,
internal model, exporter, fixtures, and product copy together. Until then, the
reader should reject files that depend on unsupported features or clearly report
that the metadata is not preserved.

## Reader Task Seed

The Aseprite input feasibility note should seed the reader tasks:

- Parse the file header and frame headers for canvas size, frame count, and
  duration.
- Parse layer chunks `0x2004` for supported normal raster layers and opacity.
- Parse cel chunks `0x2005` for supported cel placement and RGBA image data.
- Parse tag chunks `0x2018` only when tag preservation or explicit
  non-preservation is implemented.
- Validate palette chunks `0x2019`, `0x0004`, and `0x0011`; convert indexed
  input only after palette semantics are designed.
- Reject unsupported chunks that affect rendering, layer structure, or editor
  semantics unless a later output path has tested support.
