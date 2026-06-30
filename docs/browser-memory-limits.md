# Browser Memory Limits

Sprite to Aseprite Converter keeps selected artwork, metadata, decoded pixels,
conversion state, previews, and generated `.aseprite` bytes in the browser.
There is no server upload, remote image-processing fallback, or telemetry path
for working around memory limits.

## Decoded Pixel Cost

Compressed source size is only an input-transfer detail. Conversion memory is
driven by decoded pixels and intermediate buffers. RGBA pixels cost roughly:

```text
width x height x 4 bytes
```

That cost multiplies as data moves through the browser:

- frame multiplication: a flat sequence or animation can require one decoded
  RGBA buffer per output frame;
- layer multiplication: formats with supported layer data can require one cel
  buffer per supported layer, and formats with layers across frames can grow
  toward `width x height x 4 x frame count x layer count`; and
- export and preview overhead: compressed input bytes, decoded source images,
  canvas copies, `SpriteProject` `ImageData`, preview state, and the generated
  `.aseprite` `Blob` may exist at the same time.

Examples are approximate and exclude browser overhead:

- one 1,024 x 1,024 RGBA frame is about 4 MiB;
- one 8,192 x 8,192 decoded image is about 256 MiB;
- 100 full-canvas 1,024 x 1,024 frames are about 400 MiB; and
- 20 full-canvas layers at 2,048 x 2,048 are about 320 MiB for final cel
  pixels alone.

These estimates do not promise success. Browser memory ceilings vary by
browser, operating system, device, graphics stack, and other open tabs.

## Architecture Limits

`SpriteProject` is intentionally simple: exporters consume RGBA `ImageData`
cels rather than importer-specific compressed data. That keeps the conversion
boundary clear, but it means large files are represented as decoded pixels.
Importers must reject files whose dimensions, frame counts, layer counts, cel
counts, or decoded byte totals exceed documented project limits rather than
trying to partially convert ambiguous data.

Flat PNG, GIF, APNG, and spritesheet inputs rebuild timelines and convert
frames on generated layers. They do not recover layers from flat images.
Layered formats may preserve layers when the source format contains supported
layer data, but preserving those layers increases memory in proportion to the
number and size of cels retained.

## Archive And Container Risks

Archive-based formats such as OpenRaster, Pixelorama, and Krita can be small on
disk while expanding to much larger decoded content. Future archive or
container readers must treat entry counts, compressed sizes, uncompressed
sizes, image dimensions, frame counts, and layer counts as independent risk
factors. Parsers should avoid trusting archive metadata alone, stop reading
when a documented byte limit is exceeded, and reject malformed or unsupported
data clearly.

This applies equally to ZIP-like containers and chunked binary formats. A
valid-looking file can still contain many entries, nested metadata, repeated
pixel payloads, or compressed chunks that expand beyond what a browser tab can
hold.

## PSD And Future Aseprite Input

PSD can use substantially more memory than simple flat formats because source
layers may be stored as separate channel data before they become RGBA
`ImageData`. Even the current one-frame RGB 8-bit raster subset may retain PSD
bytes, per-channel decode buffers, full-canvas layer cels, preview state, and
export bytes during one conversion. Broader PSD support would add higher-risk
features such as masks, effects, groups, smart objects, more color modes,
animation timelines, or PSB-sized documents, so unsupported data must remain
bounded and rejected rather than flattened into a misleading result.

Future `.ase` or `.aseprite` input has similar risks. A reader would need to
bound file, frame, chunk, layer, cel, linked-cel, compressed-cel, tilemap, and
decoded-pixel totals before producing `SpriteProject`. Bidirectional workflows
may also hold the source file, decoded input model, edited `SpriteProject`, and
new exported bytes at the same time. Documentation and UI should describe this
as converting supported frames and preserving layers when the source contains
supported layer data, not as universal or lossless round-tripping.
