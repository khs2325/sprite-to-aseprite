# PSD Feasibility Notes

Status: researched only. Recommendation: go for a narrow PSD MVP, no-go for
full Photoshop compatibility.

Research date: 2026-06-30.

Primary references:

- Adobe Photoshop File Formats Specification:
  https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
- W3C File API:
  https://www.w3.org/TR/FileAPI/
- Existing product wording policy: [product-spec.md](product-spec.md)

## Recommendation

A browser-local PSD MVP is practical only if it is treated as a small binary
reader for fixture-backed raster data, not as broad Photoshop import.

Proceed with a future PSD MVP only for version-1 `.psd` files with RGB color,
8 bits per channel, direct raster layers, and exactly one generated
`SpriteFrame`. The importer should preserve supported layer names, visibility,
opacity, offsets, and pixel data when those values are present in supported
layer records. It should convert those layers into `SpriteProject` layers and
let the existing exporter produce a new `.aseprite` file.

Do not promise perfect or lossless PSD conversion. The product should say it
can preserve layers when the PSD source contains supported raster layer data.
It must not claim to recover layers from a flattened composite image.

All PSD processing must stay browser-only. User artwork must not be uploaded to
a server or sent to a remote converter.

## Why A Narrow MVP Is Feasible

The documented PSD container has a predictable high-level shape:

- A fixed file header with signature, version, channel count, canvas size,
  bit depth, and color mode.
- Length-delimited color mode data, image resources, layer and mask
  information, and merged image data sections.
- Layer records that include layer rectangles, channel references, blend mode
  metadata, opacity, visibility flags, mask/blending data, layer names, and
  additional layer information blocks.
- Per-layer channel image data that can be raw, PackBits RLE, ZIP, or ZIP with
  prediction.

That is enough for a conservative reader to accept a small subset:

- Signature `8BPS`, version `1`, not PSB.
- Color mode `RGB`, depth `8`, and channels sufficient for RGB plus optional
  alpha/transparency.
- One or more direct raster layers whose channel IDs map to red, green, blue,
  and optional transparency.
- Normal blend mode only, with no layer masks, effects, groups, smart objects,
  adjustment behavior, or timeline metadata.
- Raw or PackBits RLE channel data at first. ZIP-compressed channel data should
  be rejected unless a separate task justifies and tests a browser-local
  decompressor.

The `SpriteProject` mapping can be simple:

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
      cels: [{ frameIndex: 0, x: layer.left, y: layer.top, imageData }],
    },
  ],
}
```

Layer names are likely supportable from the Unicode layer name block when it is
present, with the shorter Pascal layer name as a fallback only when safely
decoded. Layer opacity is likely supportable from the layer record opacity byte,
mapped into the existing `SpriteLayer.opacity` convention. Visibility is likely
supportable from layer flags. Layer order must be fixture-backed because PSD
record order and editor UI order need to be mapped deliberately.

## MVP Boundaries

Initial support should be limited to:

- `.psd`, not `.psb`.
- Version-1 PSD files.
- RGB color mode only.
- 8 bits per channel only.
- One frame only.
- Direct raster layers only.
- Normal blend mode only.
- Layer rectangles inside safe project limits.
- Layer names, visibility, opacity, offsets, and RGBA pixels when present in
  the supported structures.
- Clear rejection for unsupported or malformed data before producing
  `SpriteProject`.

The first importer should require supported layer records. If a PSD contains
only merged image data, that flattened image does not contain recoverable source
layers. A later flat-composite fallback could convert it into one generated
layer, but that would not be layer preservation.

## Explicit Non-Support

Reject the whole file with a safe diagnostic for:

- PSB / Large Document Format.
- CMYK, indexed color, grayscale, Lab, duotone, bitmap, multichannel, or any
  other non-RGB color mode.
- 1-bit, 16-bit, or 32-bit channel depth.
- Text layers.
- Smart objects.
- Adjustment layers.
- Layer effects and styles.
- Layer masks, vector masks, user masks, clipping masks, and mask parameters.
- Groups, folders, section dividers, nested layers, and pass-through behavior.
- Non-normal blend modes, blend ranges, unsupported opacity/compositing
  semantics, and profile-dependent color conversion.
- Timeline animation, video frames, frame durations, onion-skin metadata, or
  layer-name conventions that pretend layers are frames.
- External assets, linked files, embedded objects, unknown pixel-affecting
  descriptor data, or unsupported additional layer information.
- ZIP or ZIP-with-prediction channel compression until separately researched
  and tested.
- Invalid sizes, offsets, channel lengths, duplicate channel IDs, unsafe
  allocation sizes, malformed strings, or trailing data that would require
  guessing.

Unsupported features should be named honestly. The diagnostic should not expose
raw artwork bytes, decompressed pixel data, stack traces, or local user paths.

## Browser Memory And Security Risks

PSD files can be much larger than typical sprite inputs. The public format
allows dimensions up to 30,000 pixels in either direction for PSD, which is far
beyond what this app should allocate in browser memory. Even small files can
expand into large decoded buffers because every accepted layer needs separate
RGBA `ImageData`.

Recommended initial limits before allocation:

- File size: 25 MiB.
- Canvas width and height: `1..2048`, with a lower UI warning threshold for
  sprite-focused workflows.
- Layers: `1..64`.
- Layer rectangle width and height: positive and bounded by the canvas.
- Total decoded layer pixels: `width * height * acceptedLayers <= 16,777,216`.
- Total decoded RGBA bytes: `decodedPixels * 4 <= 64 MiB`.
- Layer/channel count, resource block count, additional-info block count, and
  string lengths must all have explicit caps.

Parsing should validate section lengths, channel lengths, RLE scanline byte
counts, rectangle math, and multiplication overflow before reading or
allocating pixel buffers. PackBits RLE must fail closed on overrun, underrun,
or decoded length mismatch.

Use browser file APIs only after the user selects or drops a file. Prefer
bounded reads from `Blob.slice()` when practical. Avoid keeping extra copies of
the full PSD, decoded channels, and final `ImageData` longer than needed.
Revoke object URLs used for previews or downloads.

The parser should be independent from UI code and should expose sanitized
diagnostics. A malicious PSD should at worst produce a controlled rejection,
not freeze the tab, exhaust memory, leak local paths, or trigger network
activity.

## Future Task Shape

1. Fixture research:
   - Generate tiny synthetic PSD files from pinned tools.
   - Cover one layer, two layers, transparent pixels, hidden layers, opacity,
     offsets, Unicode layer names, raw channel data, PackBits RLE channel data,
     and unsupported feature examples.
2. Binary reader scaffold:
   - Add a bounded big-endian reader, section envelope validation, string
     decoding, and PackBits RLE validation.
3. Minimal PSD importer:
   - Convert only the documented RGB 8-bit raster-layer subset into
     `SpriteProject`.
   - Reject unsupported data clearly.
   - Add parser and importer tests before any UI wiring.
4. Browser UI wiring:
   - Add PSD selection only after core tests pass.
   - Keep copy precise: convert supported raster layers into one Aseprite
     timeline frame, preserve layers only when the source PSD contains
     supported layer data, and never upload artwork.

Do not add a PSD dependency, server conversion path, or broad compatibility UI
copy as part of feasibility work.
