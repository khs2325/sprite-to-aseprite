# Animated PNG import format

Task 046 defines this input contract and deterministic fixtures. Task 047 may
implement the core importer against it. APNG bytes must be parsed and decoded
in the browser and must never be uploaded. A flat APNG has no recoverable
source layers, so import will rebuild its timeline on one generated layer.

Primary format references are the [APNG specification](https://wiki.mozilla.org/APNG_Specification)
and the [PNG specification](https://www.w3.org/TR/png-3/).

## Decoder choice

The canonical path should be a project-owned PNG/APNG chunk parser, PNG row
filter reconstructor, and APNG compositor. It can use the browser's
`DecompressionStream("deflate")` only for zlib inflation. This keeps animation
semantics under test without adding a production codec dependency.

| Option | Availability and tradeoff | Decision |
| --- | --- | --- |
| `ImageDecoder` (WebCodecs) | May expose decoded animated `image/png` frames, but support is runtime- and codec-dependent. It does not replace validation of APNG chunk order, sequence numbers, bounds, or the exact normalization in this contract. | Do not require it. Consider only as a later optimization after pixel/timing parity tests. |
| `createImageBitmap`, `HTMLImageElement`, and canvas | Browser-local and dependency-free, but expose a rendered image rather than the APNG frame-control stream. They cannot reliably recover frame rectangles, raw delays, blend operations, or disposal operations. | Not suitable for canonical decoding. |
| `DecompressionStream("deflate")` plus project-owned parsing | Browser-local and dependency-free. It handles the zlib stream while owned code validates chunks, reverses PNG filters, and composites frames deterministically. Output must be read with a strict byte limit because decompression can expand hostile input. | Canonical strategy. |
| New generic PNG/APNG package | Could reduce implementation work, but adds production code and does not remove the need to enforce this subset and its resource limits. | Do not add for task 047. |

The core importer should accept an injectable asynchronous zlib inflater so
Node tests can use `node:zlib`. The browser default should feature-detect
`DecompressionStream`; an unavailable API must produce a clear unsupported-
browser error before decoding, not trigger an upload or server fallback. See
the [Compression Streams specification](https://compression.spec.whatwg.org/)
and the [WebCodecs image-decoding model](https://www.w3.org/TR/webcodecs/#image-decoding).

## Minimum supported subset

The first implementation accepts only this intentionally narrow subset:

- The exact eight-byte PNG signature and a file no larger than 16 MiB.
- An `IHDR` chunk first, exactly once, with length 13. Width and height must be
  1 through 4096, with at most 16,777,216 canvas pixels. Supported IHDR values
  are bit depth 8, color type 6 (RGBA), compression method 0, filter method 0,
  and interlace method 0. Palette, grayscale, RGB-only, 16-bit, and Adam7 PNGs
  are valid PNG variants but unsupported by this subset.
- Exactly these chunks in this order:

  ```text
  IHDR acTL fcTL IDAT+ (fcTL fdAT+)* IEND
  ```

  No other critical or ancillary chunks are accepted initially. In
  particular, color-profile and transfer-function chunks are rejected instead
  of being silently ignored. Accepted sample bytes are mapped directly to
  sRGB `ImageData` channel values.
- Every chunk must fit completely in the file, use a valid PNG type code with
  an uppercase reserved third letter, and have a correct CRC over its type and
  data. `IEND` must have length zero and end the file with no trailing bytes.
- `acTL` has length 8, appears exactly once immediately after `IHDR`, and
  declares 1 through 1,000 frames. Its unsigned `num_plays` value is validated;
  zero means infinite playback. `SpriteProject` has no loop field, so the
  value may be retained as parse metadata but is not converted into duplicate
  frames.
- The first `fcTL` appears before the first `IDAT`, which makes the default PNG
  image animation frame 0. It has length 26, sequence number zero, canvas-sized
  width and height, and zero offsets. APNGs whose default image is not part of
  the animation are outside this subset.
- Frame 0 image bytes are the concatenated payloads of one or more consecutive
  `IDAT` chunks. Every later frame has one `fcTL` followed by one or more
  consecutive `fdAT` chunks; the first four bytes of each `fdAT` payload are
  its sequence number and the remaining bytes form that frame's zlib stream.
- Sequence numbers across every `fcTL` and `fdAT` start at zero and increase by
  exactly one without gaps, duplicates, reordering, or 32-bit wraparound.
  `IDAT` has no sequence number. The decoded frame count must exactly match
  `acTL.num_frames`, and every frame must contain image data.
- Every frame width and height is non-zero. Unsigned offsets and dimensions
  must fit entirely inside the canvas, checked without overflowing addition:
  `x_offset <= canvasWidth - frameWidth` and likewise for height.
- Each frame's concatenated data is exactly one valid zlib stream. After
  bounded inflation it must contain exactly
  `height * (1 + width * 4)` bytes. Each row starts with PNG filter type 0, 1,
  2, 3, or 4; the importer must reverse all five filters with four bytes per
  pixel. Filtering restarts for each frame, uses the subframe width, and treats
  the row before that frame's first row as zero bytes; canvas offsets never
  participate in filtering. Invalid filters, truncated or overlong output,
  invalid zlib/Adler-32, and extra compressed-stream data are errors.
- At most 67,108,864 full-canvas output pixels may be produced across all
  frames (`canvasWidth * canvasHeight * frameCount`), equivalent to 256 MiB of
  RGBA bytes before object overhead. Limits must be checked before allocating
  frame snapshots. Inflation must stop and fail as soon as it exceeds the
  exact expected row-byte count.

All multi-byte fields are unsigned big-endian integers. Parsing uses checked
arithmetic and validates the complete structure before returning any partial
animation.

## Static PNG fallback policy

- A valid PNG with no `acTL` is a static PNG, not an APNG. The APNG importer
  returns a specific not-animated error; a caller may explicitly route the
  file to an existing static PNG workflow.
- Once `acTL` is present, any malformed or unsupported animation data rejects
  the whole file. Never fall back to displaying only `IDAT`, because that would
  silently discard frames.
- A valid APNG with `fcTL` after `IDAT` uses a separate default image. This is
  unsupported and rejected rather than interpreted as frame 0.
- CRC, sequence, bounds, decompression, blend, or disposal failures never
  produce a partial `SpriteProject`.

## Timing

`fcTL.delay_num / fcTL.delay_den` is a delay in seconds. A zero denominator is
defined by APNG as 100. Convert every frame independently using non-negative
integer arithmetic and round half up to the nearest millisecond:

```text
denominator = delay_den == 0 ? 100 : delay_den
roundedMs = floor((delay_num * 1000) / denominator + 0.5)
durationMs = clamp(roundedMs, 1, 65,535)
```

The multiplication is safe for 16-bit `delay_num`, but production code should
still keep the calculation explicit. Zero delay becomes 1 ms; very long delays
become 65,535 ms, matching `SpriteProject` and Aseprite bounds. Keep one output
frame per `fcTL`, including identical frames. Do not merge frames, redistribute
rounding error, or infer browser playback timing.

The timing fixture locks the edge cases to `0/100 -> 1 ms`, `1/60 -> 17 ms`,
`1/0 -> 10 ms`, and `65535/1 -> 65535 ms`.

## Blend operations

Start with a transparent black full-canvas RGBA buffer. Decode the frame's
unfiltered pixels as straight (unpremultiplied) RGBA, then apply `blend_op` to
the frame rectangle:

- `0`, source: replace the destination RGBA bytes, including replacing a
  destination pixel with transparent source bytes.
- `1`, over: apply straight-alpha source-over. For source and destination
  alpha fractions `Sa` and `Da`, `Oa = Sa + Da * (1 - Sa)`. If `Oa` is zero,
  write transparent black. Otherwise each output channel is
  `(Sc * Sa + Dc * Da * (1 - Sa)) / Oa`.

Round each resulting RGB byte and `Oa * 255` half up to the nearest integer,
then clamp to 0 through 255. No gamma-space conversion, premultiplication
leakage, or browser canvas blending is allowed. Blend values other than 0 and
1 are invalid.

## Disposal operations

For each frame, retain the necessary pre-draw rectangle, apply blending, and
copy the complete canvas as that frame's output cel. Only then apply
`dispose_op` to prepare the next frame:

- `0`, none: keep the composited canvas.
- `1`, background: clear only the current frame rectangle to transparent
  black.
- `2`, previous: restore the current frame rectangle to its exact contents
  immediately before this frame was blended.

The first frame may use none or background. First-frame previous is rejected
because this subset does not define a pre-animation canvas to restore. Values
other than 0, 1, and 2 are invalid. Disposal never changes the snapshot already
emitted for the current frame.

## Required rejection behavior

Reject with a frame/chunk-specific error rather than cropping, guessing,
ignoring, or returning partial output when input is:

- malformed: bad signature, length, type, CRC, ordering, count, sequence,
  compressed stream, row length, filter, or trailing data;
- unsupported: any non-RGBA8/interlaced IHDR, any extra chunk, a separate
  default image, unknown blend/disposal value, or first-frame previous;
- oversized: file, canvas, frame count, full-canvas output, compressed chunk,
  or inflated row data exceeds the limits above; or
- ambiguous: duplicate `acTL`/`fcTL`, mixed or non-consecutive frame data,
  missing frame data, bounds arithmetic that cannot be proven safe, or
  animation control that disagrees with the observed frames.

Useful diagnostics include `APNG chunk fdAT has an invalid CRC`,
`APNG sequence expected 4 but found 5`, and
`APNG frame 2 rectangle exceeds the 3x2 canvas`.

## Deterministic fixture strategy

`tests/fixtures/generate.mjs` owns every APNG byte. Its tiny writer emits only
RGBA8 filter-0 rows, fixed zlib level 9 streams, and the exact chunk grammar
above. It uses the existing project CRC implementation and synthetic colors;
no external or user artwork and no image codec dependency is involved.

| Fixture | Canvas | Contract locked by the fixture |
| --- | --- | --- |
| `apng/timing-offsets.apng` | 3 by 2, 4 frames | Full-canvas frame 0, three offset subframes, zero/default/fractional/saturated delays, infinite `num_plays`, and sequence numbers 0 through 6. |
| `apng/blend.apng` | 2 by 1, 3 frames | Source replacement with 50% blue and over compositing of 50% red on opaque green, producing exact RGBA `[128,127,0,255]`. |
| `apng/disposal.apng` | 3 by 1, 4 frames | None preserves red; background clears the middle pixel; previous removes a temporary blue pixel; the last snapshot proves both clears/restores occurred after output capture. |

Fixture tests validate every CRC and chunk sequence, inflate every frame,
assert the raw controls and normalized timings, and compare full composited
RGBA snapshots. Task 047 importer tests should reuse these files and create
focused malformed cases by mutating generated bytes for bad CRC, sequence,
bounds, count, filter, and zlib coverage.
