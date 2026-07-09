# Pixil/Pixilart `.pixil` Format Notes

Status: research-only. Pixil/Pixilart `.pixil` import is planned only as a
future, fixture-backed browser-local subset. No importer, exporter, browser UI
wiring, or compatibility claim exists yet.

Primary references:

- Pixilart public drawing app: https://www.pixilart.com/draw
- Existing browser-local privacy promise: [product-spec.md](product-spec.md)
- Existing importer boundary: [architecture.md](architecture.md)

The public Pixilart drawing page confirms that the editor exposes `.pixil`
project-file actions such as "Open .pixil", "Save as .pixil", and
"Import .Pixil". It also exposes canvas dimensions, frames, layers, layer
opacity, blend modes, clipping masks, alpha lock, frame speed controls,
persistent layers, and per-frame millisecond timing controls in the editor UI.
That page does not document the saved `.pixil` file schema, field names,
container type, compression, pixel payload encoding, opacity range, or exact
duration serialization. No prior repo-local Pixil/Pixilart format note,
fixture, or safe sample was found before this document.

Because the saved project structure is not publicly specified, the converter
must not guess `.pixil` semantics from the UI alone. A future importer may
consume only fields proven by public documentation or by tiny synthetic
`.pixil` fixtures created specifically for this project.

## Contract Source Rule

The future parser contract is fixture-gated:

- Accept only the exact `.pixil` container and schema proven by committed
  synthetic fixtures or public documentation.
- Reject unknown root fields, unsupported versions, alternate containers,
  malformed data, and missing required fields instead of silently inventing
  defaults.
- Never use a Pixilart gallery URL, account save, online upload, drawing replay,
  flattened preview, exported GIF, exported PNG, exported WebP, MP4/WebM video,
  or sprite-sheet download to recover project layers.
- Keep selected `.pixil` files and decoded artwork in the browser. Do not upload
  user artwork or project files to Pixilart, this project, or any other service
  for conversion.

## Planned Minimal Import Subset

The first import subset should stay smaller than Pixilart's editor feature set.
It should accept one local `.pixil` file only after fixtures prove all required
fields below. The smallest accepted project should be one frame and one direct
raster layer; multi-frame or multi-layer support should be added only after
fixtures prove the relevant saved structures.

- One raster project with explicit canvas width and height.
- Canvas dimensions validated as safe integers from `1` through `1024`.
- One or more frames in a fixture-proven order.
- One or more direct raster layers in a fixture-proven order.
- Persistent-layer behavior or an equivalent saved structure where every frame
  has the same accepted layer list.
- Normal blend mode only.
- Full-canvas cel pixels for every accepted frame/layer pair.
- RGBA pixel data decoded from the fixture-proven local payload only.

The first subset should reject projects with variable per-frame layer lists,
non-normal blend modes, clipping masks, alpha lock, layer filters, effects,
groups, tile features, references, tracing backgrounds, stamps, brushes,
custom fonts, palettes as required pixel data, selections, history, replay data,
or collaboration/social metadata.

## Field Requirements

Future implementation must update this section with exact fixture-proven field
names before parser code is added. Until then, these are the required semantics,
not guessed field names:

- Canvas size: read only from verified saved width and height fields. Reject
  absent, non-integer, zero, negative, fractional, unsafe, or oversized values.
- Frames: read only from a verified saved frame collection. Frame order must be
  explicit or proven deterministic by fixture round trips. Reject gaps,
  duplicates, empty timelines, or ambiguous order.
- Frame duration: accept only a verified per-frame millisecond value. Reject
  missing or invalid timing until a fixture proves a safe default. Map accepted
  values to `SpriteFrame.durationMs` after clamping to `1..65535`.
- Layers: read only from a verified saved layer collection. Preserve accepted
  layer names and order. Generate deterministic ids such as `pixil-layer-0`.
- Visibility: map only from a verified saved visibility field. If the saved
  format omits default visibility, document the fixture proof before defaulting
  to `true`.
- Opacity: map only from a verified saved opacity field and range. If the saved
  range is `0..1`, use `Math.round(opacity * 255)`. If the saved range is
  `0..100` or another range, update this note and tests before implementation.
- Pixel data: decode only from verified local layer/frame raster payloads. If
  payloads are PNG-backed, require valid PNG bytes whose decoded dimensions
  exactly match the canvas or documented cel rectangle. If payloads are raw
  bytes, require exactly `width * height * 4` bytes in row-major RGBA order.

Do not use flattened exports or previews as source-layer data. A flat Pixilart
PNG, GIF, WebP, MP4/WebM, or sprite-sheet export can rebuild frames through
other import paths only when those paths support it; it cannot recover original
layers.

## SpriteProject Mapping

For the accepted subset, the importer should produce:

```ts
{
  width,
  height,
  colorMode: "rgba",
  frames: sourceFrames.map((frame, index) => ({
    index,
    durationMs,
  })),
  layers: sourceLayers.map((layer, layerIndex) => ({
    id: `pixil-layer-${layerIndex}`,
    name,
    visible,
    opacity,
    cels,
  })),
}
```

Each accepted cel should map to one `SpriteCel` for its frame and layer. The
initial subset should use full-canvas cels at `(0, 0)` unless fixtures prove
that Pixil stores smaller cel rectangles with explicit offsets that can be
preserved safely. Decoded pixel data must be RGBA `ImageData`.

This can preserve layers only when the `.pixil` source contains supported,
verified layer data. It is not full Pixilart compatibility and must not be
described as lossless conversion.

## Unsupported Or Unknown Features

Reject or defer these features until separate fixture-backed contracts exist:

- Any `.pixil` container, version, or schema not covered by synthetic fixtures.
- Pixilart account saves, gallery pages, media URLs, online uploads, community
  metadata, comments, permissions, titles, descriptions, tags, or visibility
  settings.
- Flattened exports, previews, replay snapshots, GIF/WebP/MP4/WebM downloads,
  and sprite-sheet downloads as layer sources.
- Persistent layers turned off or any saved structure with ambiguous layer
  identity across frames.
- Blend modes other than normal, clipping masks, alpha lock, filters, effects,
  transforms, outlines, tile mode, reference images, tracing backgrounds,
  custom brushes, custom fonts, stamps, selections, undo history, and editor UI
  state.
- Unknown frame timing semantics, missing timing fields, non-finite durations,
  negative durations, or timing units not proven to be milliseconds.
- Unknown opacity ranges, missing visibility semantics, linked/shared cels,
  partial-canvas cel offsets, palettes required to interpret pixels, indexed
  pixels, external image URLs, encrypted/compressed variants, duplicate logical
  entries, or path traversal in archive-like containers.

The parser diagnostic should name the first unsupported or malformed feature
without exposing source artwork bytes, raw embedded image data, or stack traces.

## Fixture Strategy

Future fixtures must be synthetic, newly created, tiny, and reproducible:

- Create fixtures from Pixilart's own "New" and "Save as .pixil" flow without
  signing in, uploading, using gallery art, or importing private/user artwork.
- Use tiny canvases such as `2x2` or `3x2` with simple hand-authored pixels.
- Start with one frame and one layer at full opacity, normal blend, and default
  visibility.
- Add separate positive fixtures for two frames with distinct durations and two
  layers with distinct names, visibility, and opacity only after the saved
  fields are inspected.
- Add negative fixtures for each rejected feature only when that feature can be
  generated synthetically and safely.
- Record fixture provenance in tests or fixture docs: Pixilart page URL,
  creation date, browser used, observed schema summary, and SHA-256 hash.

Importer work must not begin until the positive fixture proves the container,
required field names, frame order, layer order, timing representation, opacity
range, visibility representation, and pixel payload encoding.
