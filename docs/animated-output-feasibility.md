# Animated Output Feasibility

Status: research only. Do not add GIF or APNG exporters, encoder
dependencies, or UI controls from this note alone.

This note covers browser-local GIF and APNG export from the internal
`SpriteProject` timeline. It applies whether the source project was rebuilt
from PNGs, a spritesheet, `.piskel`, `.aseprite`, or another future importer.
Animated outputs export flattened frames. They do not preserve Aseprite layer
structure, tags, slices, palettes, color profiles, or editor metadata unless a
future output format explicitly models and tests those fields.

## Recommendation

Implement GIF and APNG as separate tasks after a tested flattened-frame
compositor exists.

APNG should be the first animated web-output task if the product goal is
highest visual fidelity from RGBA timelines. It can preserve flattened RGBA
pixels with 8-bit alpha when encoded losslessly, but it still should not be
marketed as perfect animation fidelity because timings, color metadata, and
source editor data can differ by viewer and by the current `SpriteProject`
model.

GIF should be a later task or a parallel task with its own acceptance criteria.
It is useful for compatibility and sharing, but it requires explicit palette,
dithering, transparency, and timing policy. GIF output should be described as
"convert frames to GIF" or "export a flattened GIF preview", not as a lossless
or layer-preserving export.

## Browser-local feasibility

The browser has enough primitives to keep all processing local: decode or
compose frames to `ImageData`, encode bytes in the main thread or a Web Worker,
then download a `Blob`. No server upload is needed.

Native browser APIs are not enough for these outputs. `canvas.toBlob()` is
reliable for still-image encodings and falls back to `image/png` when a
requested type is unsupported. WebCodecs targets audio/video encoding and image
decoding; it does not provide a portable browser GIF or APNG image encoder.
Future export tasks should therefore use a JavaScript/WASM encoder or a
project-owned binary writer.

## Common prerequisites

- A compositor that consumes `SpriteProject` and emits full-canvas RGBA frames
  in frame order, applying visible layers, layer opacity, cel offsets, and the
  current canvas size.
- A timing mapper from `SpriteFrame.durationMs` to each target format, with
  validation for zero, negative, fractional, very small, and very large
  durations.
- Memory limits before encoding. Raw frame memory is approximately
  `width * height * 4 * frameCount` bytes before encoder overhead.
- Worker strategy for large animations. Encoding on the main thread is
  acceptable only for small fixtures and should not become the default for
  large user artwork.
- Binary tests that verify frame count, dimensions, delays, transparency, and
  disposal/blending choices by parsing or decoding the exported file.

## GIF feasibility

GIF is feasible, but it is a lossy web-preview format for this product.

Format constraints:

- GIF frames are indexed-color images using global or local color tables.
  Tables max out at 256 RGB entries.
- Transparency is a single transparent palette index. Partial alpha from
  `ImageData` must be flattened, thresholded, matted, or otherwise reduced.
- Frame delay is stored in hundredths of a second. `durationMs` needs a
  documented rounding policy, and very short delays may display differently
  across viewers.
- Disposal methods include no disposal specified, do not dispose, restore to
  background, and restore to previous. Full-canvas frame export can avoid most
  rectangle/disposal complexity by writing every frame as a full canvas image.
  Changed-rectangle optimization should be a separate later task.

Encoder options:

- `gifenc` is the best initial candidate. It is MIT licensed, browser/Node
  compatible, ESM/CJS capable, has no production dependencies in its package
  metadata, exposes delay/repeat/dispose options, and documents a small library
  footprint. The tradeoff is that it is lower-level and currently does not
  include dithering support, so visual quality needs sprite-specific fixtures.
- `gif.js` is a fallback candidate if dithering is more important than
  maintenance posture. It runs in browsers with Web Workers and supports delay,
  transparency, dithering options, and disposal codes, but npm shows the package
  as last published years ago and it requires a worker script asset.

Quality risks:

- Global palette export can be smaller and more stable, but it may degrade
  colorful animations.
- Local per-frame palettes can improve each frame but may cause visible color
  shifts between frames.
- Dithering can reduce banding but can introduce pixel noise that is undesirable
  for crisp sprite art.
- Alpha cannot be preserved beyond binary transparency. The UI must not imply
  PNG/APNG-quality transparency in GIF output.

Recommended GIF task scope:

1. Add a flattened full-canvas GIF exporter behind tests, using one dependency
   selected with measured bundle size and license review.
2. Start with a deterministic palette policy and explicit alpha threshold.
3. Encode full frames with documented disposal and looping defaults.
4. Add fixture tests for delays, transparent pixels, and palette degradation
   expectations.

## APNG feasibility

APNG is feasible and is a better fit for flattened RGBA animation.

Format constraints:

- APNG extends PNG with animation chunks and keeps backward compatibility with
  static PNG decoders.
- APNG supports 24-bit color and 8-bit transparency, making it a closer match
  for `SpriteProject` flattened RGBA frames than GIF.
- Frame control stores x/y offsets, width/height, delay numerator/denominator,
  disposal, and blend operation. Full-canvas frame export should use full-size
  frames and a deterministic blend/disposal policy, such as source replacement
  for each frame, then optimize rectangles only in a later task.
- Delay values are rational fractions. A future task must map milliseconds into
  valid numerator/denominator pairs and handle values that do not fit a simple
  16-bit millisecond numerator.

Encoder options:

- `UPNG.js` is the best initial APNG candidate. It is MIT licensed, supports
  APNG encode from an array of RGBA frame buffers, accepts per-frame millisecond
  delays, and can encode losslessly when `cnum` is `0`.
- Dependency risk is higher than GIF with `gifenc`: `UPNG.js` depends on
  `pako` for inflate/deflate, and the GitHub release history appears quiet.
  A future task should measure actual Vite bundle impact and confirm that the
  package works cleanly in browser workers before adding it.

Quality risks:

- Lossless APNG can preserve flattened RGBA pixels, but not layers, frame tags,
  source chunk metadata, palettes, color profiles, or any editor-only state not
  represented in `SpriteProject`.
- APNG files can be much larger than GIF for long or large animations,
  especially when each frame is stored as a full canvas.
- Some consumers display only the default PNG image or handle timing
  differently. Product copy should position APNG as an animated web output, not
  a guaranteed editor round-trip format.

Recommended APNG task scope:

1. Add a flattened full-canvas APNG exporter with measured bundle-size notes.
2. Prefer lossless RGBA output first; defer lossy color reduction controls.
3. Validate delay conversion, loop count behavior, blend operation, and disposal
   by parsing the APNG chunks in tests.
4. Add browser smoke coverage for local `Blob` download and no upload path.

## Dependency and bundle policy

Do not add encoder dependencies in the research task.

Before any production dependency is added, the implementation task should
record:

- package name, version, license, maintenance status, and transitive
  dependencies;
- minified and gzip bundle impact under the current Vite build;
- whether the encoder can run in a Web Worker without special global shims;
- memory behavior for representative small, medium, and large sprite timelines;
- fixture-backed output compatibility in current Chromium, Firefox, and Safari
  where practical.

## Next steps

1. Finish or confirm the shared flattened-frame compositor for non-Aseprite
   outputs.
2. Create an APNG exporter task scoped to full-canvas lossless RGBA frames.
3. Create a separate GIF exporter task scoped to full-canvas indexed frames with
   documented palette and alpha policies.
4. Keep optimized frame rectangles, lossy APNG quantization, GIF dithering
   controls, and advanced disposal tuning as follow-up tasks.

## References

- GIF89a specification: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
- APNG specification: https://wiki.mozilla.org/APNG_Specification
- MDN `canvas.toBlob()`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
- MDN WebCodecs API: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
- `gifenc`: https://github.com/mattdesl/gifenc
- `gif.js`: https://github.com/jnordberg/gif.js
- `UPNG.js`: https://github.com/photopea/UPNG.js
