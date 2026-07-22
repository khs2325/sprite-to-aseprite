# Pixilart `.pixil` 2.7 Supported Subset

Status: supported compatibility subset based on a genuine Pixilart 2.7.0 save
observed during testing. This is not universal or lossless Pixil compatibility.
All processing is browser-local; artwork is neither uploaded nor fetched.

## Accepted structure

The file must be JSON with `application: "pixil"`, `type: ".pixil"`,
`version: "2.7.0"`, `website: "pixilart.com"`, canvas `width` and `height`, and a
non-empty `frames` array. Dimensions may be safe integers or canonical
non-negative integer strings. Each frame must repeat the canvas dimensions,
provide a positive integer `speed` in milliseconds, and contain `layers`.

Each frame layer must provide:

- a non-empty `name`;
- opacity from 0 through 1 as a finite number or canonical numeric string;
- `options.blend: "source-over"`, mapped to normal compositing;
- embedded PNG data in `src`; the importer locates the `base64,` marker instead
  of requiring one exact data-URL prefix; and
- stable identity. A validated, non-empty `unqid` is preferred. If it is absent,
  a non-negative safe-integer `id` is the only fallback.

Logical layer identities, order, name, and opacity must agree across frames.
Each decoded PNG must be full-canvas RGBA data. Layer names, order, opacity,
pixels, frame order, and frame timing are converted. `active` is validated as a
boolean when present but is not mapped to Aseprite visibility; its editor-state
semantics are not established, so imported layers remain visible.

Pixilart documents frame time in milliseconds, so `speed` is preserved as the
frame duration, subject to the canonical Aseprite duration normalization range.

## Validation and limits

- file/JSON text: 96 MiB;
- dimensions: 1 through 1024 each;
- frames: 1 through 512;
- layers per frame: 1 through 64;
- cels: at most 4096;
- embedded decoded PNG payload bytes: at most 64 MiB total; and
- allocated decoded RGBA cel bytes: at most 64 MiB total.

Malformed base64, non-PNG signatures, decoder failures, decoded dimension
mismatches, fractional/zero/negative/unsafe dimensions, inconsistent layer
identity, and unsupported blends are rejected with content-safe diagnostics.
Editor metadata such as palettes, previews, selection state, locks, default
filters, frame names, and project contact fields is not exported.

The former repository-defined `{ pixil: { schemaVersion: 1, ... } }` raw-RGBA
fixture schema was not a genuine Pixilart schema and is intentionally rejected
with a migration diagnostic.

## Manual verification with a genuine local file

1. Keep the genuine `.pixil` file outside the repository; do not copy, rename,
   encode, or commit it as a fixture.
2. Run the app locally and choose **Pixil/Pixilart project**.
3. Select the local file and convert it to `.aseprite`.
4. Open the result in Aseprite and compare canvas size, timeline timing, layer
   order/names/opacity, and pixels against the source in Pixilart.
5. Confirm no source file, artwork, embedded PNG, or base64 text appears in
   `git status` or the staged diff.

The committed 2×2 fixture mirrors the observed 2.7.0 container and field
structure only. Every pixel and embedded PNG in it was freshly generated for
this repository and is unrelated to the genuine compatibility-test artwork.
