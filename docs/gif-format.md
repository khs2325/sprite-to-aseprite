# Animated GIF import research

Task 044 defines the input contract for the core importer planned in task 045.
It does not add GIF decoding or UI support. GIF artwork must be parsed in the
browser from the selected file bytes and must never be uploaded.

## Decoder choice

The canonical decoder should be a small TypeScript GIF block parser, LZW
decoder, and compositor operating on `Uint8Array`. It should have no DOM or UI
dependency and should return one generated `SpriteLayer` in a `SpriteProject`.
A flat GIF has no recoverable source layers.

| Option | Availability and tradeoff | Decision |
| --- | --- | --- |
| `ImageDecoder` (WebCodecs) | Can expose animated image frames, durations, and repetition metadata when both the API and `image/gif` codec are present. It requires runtime feature detection, is not available in every target browser/test runtime, and native timing/compositing normalization is not guaranteed to match this contract. | Do not require it. A later optimization may use it only after parity tests against the canonical decoder. |
| `createImageBitmap`, `HTMLImageElement`, and canvas | Browser-local and dependency-free, but they expose a rendered image rather than a deterministic GIF block/frame API. Timer-driven canvas capture cannot reliably recover source delays, rectangles, or disposal. | Not suitable for decoding. |
| `DecompressionStream` | Has no GIF LZW format and does not parse GIF blocks. | Not applicable. |
| Project-owned parser and LZW decoder | Works in browsers and Node tests, permits strict limits/errors, and makes timing and disposal deterministic. It adds code that must be covered by malformed-stream and compositing tests. | Required strategy for task 045. |

Feature detection for an optional native path must check both
`globalThis.ImageDecoder` and `ImageDecoder.isTypeSupported("image/gif")`.
Native decoding must never be the only path. Primary references are the
[GIF89a specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt) and the
[WebCodecs image-decoding model](https://www.w3.org/TR/webcodecs/#image-decoding).

## Supported subset

Task 045 should accept this minimum subset and reject everything else before
allocating decoded frame output:

- Header version `GIF89a` only. Reject `GIF87a` as unsupported rather than
  guessing animation timing.
- Logical-screen width and height from 1 through 4096, at most 16,777,216
  pixels. Pixel aspect ratio must be zero.
- An input file of at most 16 MiB, at most 1,000 image descriptors, and at most
  67,108,864 full-canvas output pixels (`width * height * frameCount`). The last
  limit is 256 MiB of RGBA output before object overhead.
- Global and per-image local color tables with 2 through 256 entries. Every
  decoded palette index, background index when used, and transparent index
  must exist in its applicable table.
- A first image that covers the complete logical screen. Later image
  rectangles may be offset or smaller, but must have non-zero dimensions and
  remain entirely inside the logical screen.
- Non-interlaced image descriptors only for the initial implementation.
  Interlaced images must fail with a specific unsupported-interlacing error;
  task 045 must not interpret interlaced rows as sequential rows.
- LZW minimum code sizes 2 through 8. Each image must have a clear code, an end
  code, valid dictionary/code-size transitions, and exactly `width * height`
  decoded indexes. Truncated, overlong, or invalid LZW data is an error.
- A Graphic Control Extension (GCE) may precede each image. Its scope is only
  the next rendering block and must then reset. Missing GCE values are delay 0,
  no transparency, and disposal 0.
- Disposal methods 0, 1, 2, and 3. Methods 4 through 7 are reserved and must be
  rejected. A set GCE user-input flag must be rejected because user-driven
  timing cannot be represented by `SpriteProject`.
- A single well-formed `NETSCAPE2.0` or `ANIMEXTS1.0` application loop
  extension. Comment extensions and unknown application extensions may be
  skipped after validating their sub-block chains. Plain Text Extensions and
  unknown extension labels must be rejected because their rendering/scope is
  not represented.
- One trailer byte immediately after the block stream. Missing trailers,
  truncated sub-blocks, duplicate/conflicting loop extensions, and non-padding
  data after the trailer are errors.

Parsing should use checked integer arithmetic and enforce the limits while
scanning. An error must identify the failing frame/block and reason, for
example `GIF frame 2 rectangle exceeds the 3x2 logical screen` or
`GIF frame 1 uses unsupported disposal method 5`. Do not silently crop,
substitute indexes, ignore malformed blocks, or return partial animation.

## Timing and loop policy

GIF delay is an unsigned 16-bit count of hundredths of a second. Normalize it
without consulting browser playback behavior:

```text
delay == 0: 100 ms
delay > 0:  clamp(delay * 10, 20, 65,535) ms
```

The zero default prevents a missing delay from becoming a zero-duration frame;
the 20 ms floor avoids busy-loop animation; and 65,535 ms matches the current
Aseprite frame-duration ceiling. Keep one output frame per GIF image, including
identical frames. Do not merge frames or redistribute durations.

Loop data is playback metadata, not frame content. Validate it and expose it
from an internal parse result if useful, where zero means infinite looping and
a positive value is the encoded repeat count. The current `SpriteProject` has
no loop field, so task 045 must intentionally omit loop metadata while
rebuilding the timeline once. It must not encode extra frames to simulate
loops.

## Transparency and compositing

Produce a full logical-screen RGBA snapshot for every image descriptor on one
generated layer. Start the working canvas transparent; the full-canvas first
image requirement removes ambiguity about untouched initial pixels. For each
frame:

1. Save the pre-draw canvas if disposal method 3 is requested.
2. Decode the frame rectangle. A pixel matching the GCE transparent index does
   not modify the destination; every other index replaces the destination with
   the palette RGB value and alpha 255.
3. Copy the complete canvas as that frame's output cel, before disposal.
4. Prepare for the next frame: methods 0/1 keep the canvas; method 2 clears only
   the frame rectangle; method 3 restores the saved pre-draw canvas.

For method 2, clear to transparent when that frame's GCE has transparency.
Otherwise clear to the opaque logical-screen background color from the global
table. Reject method 2 without a usable global background color when no
transparent clear applies. Disposal is applied only after the displayed frame
snapshot is captured. Method 3 requires a snapshot from immediately before
that frame is drawn, not from the previous output after disposal.

## Deterministic fixture strategy

`tests/fixtures/generate.mjs` owns the GIF bytes. Its GIF writer deliberately
uses a tiny global palette and simple, valid clear-code-heavy LZW streams so
fixture bytes do not depend on an image library or encoder version. Structural
tests inspect headers, logical-screen data, GCE fields, application loop data,
image rectangles, interlace flags, LZW bounds, and the trailer without adding
a production decoder.

The generated fixtures cover:

- transparency, offset rectangles, delays 0/1/12/65535, and infinite loop
  metadata;
- disposal-to-background followed by another frame;
- restore-to-previous followed by another frame; and
- an out-of-bounds rectangle for precise future rejection coverage.

Task 045 should add pixel-level decode/compositing expectations for these same
files plus focused malformed LZW unit cases. The fixtures are synthetic test
patterns, not downloaded or private artwork.
