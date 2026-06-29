# PSD `.psd` Format Notes

Status: documentation-only. No user-facing PSD importer exists yet.

This note defines the intended PSD limitation contract before implementation.
Any future PSD parser must keep processing browser-local: selected PSD bytes,
decoded pixels, and generated `.aseprite` files must not be uploaded to a
server or sent to a remote converter.

Test fixtures for this format must follow the synthetic, reproducible strategy
in [psd-fixtures.md](psd-fixtures.md). Do not commit PSD samples from the web,
private projects, or user artwork.

## Initial Target

The initial target is RGB 8-bit raster layers in one-frame PSD files.

A future importer should accept only version-1 `.psd` files that can map
directly to `SpriteProject`:

```ts
{
  width: psd.width,
  height: psd.height,
  colorMode: "rgba",
  frames: [{ index: 0, durationMs: 100 }],
  layers: [
    {
      id,
      name,
      visible,
      opacity,
      cels: [{ frameIndex: 0, x, y, imageData }],
    },
  ],
}
```

Within that subset, preserve supported raster layer names, source order,
visibility, opacity, offsets, and RGBA pixel data when those values are present
in supported layer records.

This is not full Photoshop compatibility. It is not perfect or lossless PSD
conversion. It must not claim to recover layers from a flattened composite
image.

## Metadata Validation Limits

Before invoking a PSD parser that may allocate decoded pixel buffers, the
importer validates the document header and high-level section envelope. The MVP
accepts only:

- Signature `8BPS` and version `1` PSD files. PSB / Large Document Format is
  rejected.
- RGB color mode (`3`) and 8 bits per channel.
- Canvas width and height from `1..2048`.
- Declared PSD layer count from `1..64`.
- Total potential decoded layer pixels at or below `16,777,216`, computed as
  `width * height * declaredLayerCount`.
- Files at or below `25 MiB`.

Invalid section lengths, missing layer-count metadata, unsupported color
interpretation, unsupported depth, unsafe dimensions, unsafe layer counts, and
oversized decoded-pixel allocations reject before producing parser output.
Diagnostics must be adapter-authored messages only: no stack traces, raw source
bytes, decoded pixels, or local file paths.

## PSD To `SpriteProject` Mapping

The PSD importer owns all Photoshop-specific parsing and validation. Its output
contract is a plain `SpriteProject`; the Aseprite exporter must not inspect PSD
metadata, decode PSD channels, apply PSD blend behavior, or diagnose PSD
features.

Canvas mapping:

- `SpriteProject.width` is the PSD header width in pixels.
- `SpriteProject.height` is the PSD header height in pixels.
- `SpriteProject.colorMode` is always `"rgba"` for accepted files.
- Resolution, ruler, guide, thumbnail, and merged-composite metadata do not map
  to `SpriteProject`.
- Do not trim, scale, resample, or expand the canvas while importing.

Frame mapping for the MVP:

- Accepted PSD files always produce exactly one frame:
  `{ index: 0, durationMs: 100 }`.
- Every supported layer cel has `frameIndex: 0`.
- PSD timeline, video, frame animation metadata, and layer-name conventions that
  imply frames are unsupported. Reject those files rather than rebuilding a
  guessed timeline.

Raster layer mapping:

- Accept only direct raster layers with normal blend mode and supported pixel
  channels. Groups, text, smart objects, adjustments, masks, effects, clipping,
  and non-normal blending are not raster-layer preservation.
- `SpriteProject.layers` preserves the PSD root layer stack in Photoshop visual
  order, top layer first. If a parser exposes layers bottom-first, the adapter
  must normalize to top-first before creating `SpriteProject`.
- `SpriteLayer.id` is generated deterministically from the normalized source
  layer index, such as `psd-layer-0`.
- `SpriteLayer.name` uses the Unicode layer name when present. Fall back to the
  Pascal layer name only when it decodes safely. If no usable name exists, use a
  deterministic generated name such as `Layer 1`.
- `SpriteLayer.visible` maps from the PSD layer visibility flag. For parser APIs
  that expose `hidden`, use `visible = !hidden`.
- `SpriteLayer.opacity` is the PSD layer opacity mapped to the internal
  `0..255` integer range. A raw PSD opacity byte maps directly; a parser value
  in `0..1` maps with `Math.round(value * 255)`.
- Each supported raster layer creates one `SpriteCel` for frame `0`.
- `SpriteCel.x` is the layer rectangle `left` offset and `SpriteCel.y` is the
  layer rectangle `top` offset. Offsets are signed integers. Do not bake the
  offset into pixel data.
- `SpriteCel.imageData.width` is `right - left`; `SpriteCel.imageData.height`
  is `bottom - top`. These dimensions must be positive and within allocation
  limits before constructing `ImageData`.
- Pixel data is row-major RGBA for the layer rectangle, starting at that
  rectangle's top-left pixel. PSD channel `0` maps to red, `1` to green, `2` to
  blue, and `-1` to alpha. If a supported raster layer has no transparency
  channel, synthesize alpha `255`.
- Do not premultiply alpha, apply layer opacity into pixels, composite layers,
  consume the flattened merged image, or use masks/effects to alter cel pixels.
  Layer opacity remains `SpriteLayer.opacity`; per-pixel alpha remains in
  `ImageData`.
- Missing required channels, duplicate channel IDs, channel dimensions or
  decoded byte counts that do not match the layer rectangle, empty raster
  layers, and unsafe rectangles must reject the file with a diagnostic.

## Unsupported Feature Behavior

Unsupported PSD features must not be silently presented as preserved. They
should produce clear diagnostics or be documented as omitted when they do not
affect the `SpriteProject` output.

When rejecting, fail the whole import before producing `SpriteProject`. The
diagnostic should name the first unsupported or malformed feature in product
terms, such as `PSD text layers are not supported`, and may include safe layer
names or section names. It must not expose raw artwork bytes, decoded pixel
data, stack traces, or local user file paths.

Reject the file with a specific diagnostic for unsupported features that affect
pixels, layer structure, color interpretation, or timeline behavior, including:

- PSB / Large Document Format.
- Color modes other than RGB, including CMYK, indexed color, grayscale, Lab,
  duotone, bitmap, and multichannel.
- Channel depths other than 8 bits per channel.
- Text layers, smart objects, adjustment layers, and layer effects/styles.
- Layer masks, vector masks, user masks, clipping masks, and mask parameters.
- Groups, folders, section dividers, nested layers, and pass-through behavior.
- Non-normal blend modes, blend ranges, profile-dependent color conversion, or
  other compositing semantics that are not represented by `SpriteProject`.
- Animation, video frames, timeline metadata, frame durations, and conventions
  that treat layer names as animation frames.
- External assets, linked files, embedded objects, or unknown descriptor data
  that could affect rendered pixels.
- Malformed data, unsafe dimensions, unsafe allocation sizes, duplicate channel
  IDs, invalid layer rectangles, unsupported compression, or channel lengths
  that require guessing.

Documented omission is acceptable only for metadata that does not change the
converted pixels, layers, or frame timing, such as thumbnails, guides, rulers,
or editor-only notes. Omitted metadata must not be described as preserved.

Do not flatten unsupported text, smart objects, effects, masks, groups, or
animation into the output. If a later flat-composite fallback is explicitly
scoped, it must create one generated layer and state that source layers were not
preserved.
