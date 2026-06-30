# Architecture

## Main idea

Sprite to Aseprite Converter is a static browser app. User artwork and metadata
are read, decoded, converted, previewed, and exported in the browser. The app
does not upload source files to a server or call remote image-processing APIs.

Every importer converts its supported source format into the shared internal
model, `SpriteProject`. Every exporter consumes `SpriteProject`.

```text
Browser-selected files
  -> UI source validation and mode selection
  -> format importer
  -> SpriteProject
  -> preview, frame timing, and layer-name UI
  -> Aseprite exporter
  -> local Blob download
```

## Internal model

`SpriteProject` is the boundary between importers, UI tools, validation, and
exporters.

```ts
type SpriteProject = {
  width: number;
  height: number;
  colorMode: "rgba";
  frames: SpriteFrame[];
  frameTags?: SpriteFrameTag[];
  layers: SpriteLayer[];
};

type SpriteFrame = {
  index: number;
  durationMs: number;
};

type SpriteFrameTag = {
  name: string;
  from: number;
  to: number;
  direction: "forward" | "reverse" | "ping-pong";
};

type SpriteLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  cels: SpriteCel[];
};

type SpriteCel = {
  frameIndex: number;
  x: number;
  y: number;
  imageData: ImageData;
};
```

Importers must emit zero-based, ordered frame indexes and RGBA `ImageData`.
Each layer may contain at most one cel per frame. UI code may rename layers and
edit frame durations, but core file parsing and binary writing stay independent
from UI components.

Because `SpriteProject` stores decoded RGBA `ImageData`, browser memory scales
with pixel dimensions, frame count, layer count, importer working buffers, and
export bytes rather than only source file size. Architecture-level guidance and
future-format risks are documented in
[browser-memory-limits.md](browser-memory-limits.md).

## Importer responsibilities

All current importers live under `src/core/importers/*` and return
`SpriteProject`.

Importers own source-format parsing, validation, decoding, and mapping into the
canonical model. They may use model helpers from `src/core/SpriteProject.ts` and
shared validators from `src/core/validation`, but they must not import exporter
modules or rely on Aseprite writer internals. Timing, layers, cels, and optional
metadata should be expressed as `SpriteProject` fields before any export step.

- PNG sequence: decodes each PNG with browser image APIs, requires matching
  dimensions, creates one frame per file, and places full-frame cels on one
  generated `Main` layer.
- Spritesheet grid: decodes one PNG, requires a grid that exactly covers the
  image, slices frames in row-major or column-major order, and places each slice
  on one generated `Main` layer.
- Spritesheet PNG + JSON: parses the documented atlas JSON subset, decodes one
  PNG, rebuilds each declared frame rectangle, supports per-frame durations,
  supported Aseprite frame tags, supported 90-degree clockwise atlas rotation,
  and complete trim placement metadata. It outputs one generated `Main` layer.
- GIF: parses, decodes, composites, and times the supported GIF subset locally.
  It rebuilds animation frames on one generated `GIF frames` layer.
- APNG: parses, decodes, composites, and times the supported APNG subset
  locally. It rebuilds animation frames on one generated `APNG frames` layer.
- Piskel: parses the documented model-version-2 `.piskel` subset, decodes
  embedded PNG chunks, skips hidden source frames, applies the global FPS timing,
  and preserves supported source layer names, order, visibility, opacity, and
  pixels.
- OpenRaster: parses the documented single-frame `.ora` ZIP subset, reads
  `stack.xml` and PNG-backed normal raster layers, and preserves supported layer
  names, order, visibility, opacity, x/y offsets, and pixels.
- Pixelorama: parses the documented `.pxo` ZIP subset, converts supported frame
  timing and raw RGBA cel data, and preserves supported raster layer names,
  order, visibility, opacity, and pixels.
- Krita: parses the documented single-frame `.kra` raster subset, reads native
  paint-layer payloads, and preserves supported layer names, order, visibility,
  opacity, x/y offsets, and pixels.
- PSD: parses the documented RGB 8-bit PSD raster-layer subset, converts
  supported layers into one-frame full-canvas cels, and preserves supported
  layer names, order, visibility, opacity, and pixels.

Flat formats such as PNG sequences, spritesheets, GIF, and APNG do not contain
editable source-layer structure. These importers rebuild timelines and convert
frames on generated layers; they do not recover layers from flat images. Layer
preservation is only possible when the source format contains supported layer
data.

Parsers should reject malformed or unsupported data clearly instead of silently
inventing missing geometry, timing, layer, or pixel semantics.

## UI responsibilities

The app UI classifies browser-selected files by extension or MIME type, reads
text or bytes with browser file APIs, and validates the selected file count for
the active import mode before conversion.

`convertSourceFiles` is the UI-to-core handoff. It chooses exactly one importer
for the active mode and passes only local `File` objects plus mode-specific
options such as spritesheet grid dimensions and frame order.

After conversion, the UI stores the resulting `SpriteProject` in preview,
layer-name, and export controls. The preview and layer-name controls operate on
the model rather than source files. The export control validates that the
current value is a valid `SpriteProject` before enabling download.

Browser-only preview behavior is allowed, including object URLs for selected
PNG thumbnails and grid overlays. Those object URLs must be revoked when they
are no longer needed.

## Aseprite exporter responsibilities

The Aseprite exporter consumes only `SpriteProject`; it does not parse source
formats or inspect UI state. It validates supported model fields, rejects
unsupported color modes and invalid ranges, and writes a binary `.aseprite`
document.

Exporter-specific limits and binary compatibility checks belong here. If a
future exporter needs different constraints, it should consume the same
`SpriteProject` contract and enforce its own output rules without changing
source importers.

The current writer supports:

- 32-bit RGBA documents
- multiple frames with per-frame durations
- optional ordered frame tags
- normal layers with names, visibility, and opacity
- compressed RGBA image cels with x/y positions

The current writer does not export advanced Aseprite features that are not in
`SpriteProject`, such as indexed or grayscale color modes, layer groups,
tilemaps, non-normal blend modes, linked cels, per-cel opacity, slices,
palettes, tilesets, user data, or color profiles.

The download UI wraps exported bytes in a local `Blob` with the Aseprite MIME
type, creates a local object URL, clicks a download link, and revokes the URL.
No exported artwork is uploaded.

## Future output selector

Additional output formats should be added through exporter modules that consume
`SpriteProject`, not by changing importers or binding source formats directly to
download code. The selector plan in
[output-format-selector.md](output-format-selector.md) keeps Aseprite as the
only enabled output until another exporter has documented limits, tests, and
browser-local Blob download behavior.

Bidirectional planning is tracked in
[bidirectional-conversion.md](bidirectional-conversion.md). Even when future
`.ase` or `.aseprite` input exists, imported data should cross the same
`SpriteProject` boundary before export; output files are generated from the
supported model fields, not from preserved raw source chunks.
