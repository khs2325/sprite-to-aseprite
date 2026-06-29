# ag-psd Browser Evaluation

Status: researched only. Recommendation: do a small dependency spike before
adopting `ag-psd` for PSD import.

Research date: 2026-06-30.

Primary references:

- ag-psd README: https://github.com/Agamnentzar/ag-psd
- ag-psd package listing: https://app.unpkg.com/ag-psd
- ag-psd package metadata: https://app.unpkg.com/ag-psd@30.2.0/files/package.json
- ag-psd license: https://raw.githubusercontent.com/Agamnentzar/ag-psd/master/LICENSE
- ag-psd commit history: https://github.com/Agamnentzar/ag-psd/commits/master/
- Existing PSD feasibility note: [psd-feasibility.md](psd-feasibility.md)

## Recommendation

Do not add `ag-psd` in the first PSD dependency task without a focused spike.
It is a credible candidate for browser-local PSD parsing, but the adapter risk
is high enough that adoption should be proven with fixtures and bundle output
first.

The spike should answer whether `ag-psd` can reliably convert only supported
RGB raster layer data into `SpriteProject`, while rejecting unsupported PSD
features clearly. The app must still preserve layers only when the PSD source
contains supported raster layer data. It must not promise full Photoshop
compatibility or lossless conversion.

If the spike passes, a later dependency task is acceptable. That task must
explicitly include `package.json` and the lockfile in its allowed scope, pin the
chosen `ag-psd` version, and record bundle-size and security notes in the PR or
task summary.

## Package Status

The package is actively maintained but fast-moving. Public metadata observed
during research showed recent releases, with UNPKG listing `30.2.0` as recently
published and the package selector also exposing `31.0.0` as latest. GitHub
master package metadata also reports `31.0.0`. A future dependency task should
re-check the exact npm latest version with `npm view ag-psd version` before
pinning.

Maintenance signals are positive but not risk-free:

- The GitHub repository has recent 2026 commits, including bitmap decoding
  work.
- The package has one primary maintainer.
- The API and behavior have changed across major versions, so exact-version
  fixture tests are required.
- There are open issues, and PSD is a broad, underspecified compatibility
  surface.

License compatibility looks acceptable. The package metadata declares MIT, and
the repository license is MIT for the software. The license file separately
notes that image or brush files included in the repository are not covered by
that license. Do not copy third-party PSD, image, or brush fixtures from the
repository into this project.

## Browser And API Fit

`ag-psd` is designed to run in browsers. It exposes `readPsd(buffer, options)`
for `ArrayBuffer`, typed-array, or Node buffer input, and its README documents
browser usage with `XMLHttpRequest` plus a standalone browser bundle.

The API shape mostly fits this project:

- `readPsd` accepts the browser `ArrayBuffer` returned by local `File` or
  `Blob` reads.
- Layer objects include names, visibility through `hidden`, opacity, offsets,
  blend mode, and image data or canvas data.
- `useImageData: true` can expose `ImageData` directly, which fits
  `SpriteCel.imageData` and avoids canvas alpha premultiplication.
- `skipCompositeImageData`, `skipThumbnail`, and `skipLinkedFilesData` can
  reduce work that the converter does not need.
- Recent README options include `useRawData` and `totalMemoryLimit`, which are
  useful for bounded browser parsing, but the future task must verify these on
  the pinned version.

The adapter should run in a Web Worker if adopted. The README's worker example
uses `OffscreenCanvas` and `bitmaprenderer` for canvas transfer, but this
project should prefer `useImageData: true` and avoid canvas transfer where
possible. If any path still needs canvas APIs, browser support must be tested
against the app's target browsers.

## Bundle And Dependency Risk

Package changes are required for a later adapter task. Installing `ag-psd`
would add at least the direct package plus its runtime dependencies:

- `base64-js`
- `pako`

The package metadata marks `"sideEffects": true`, which may limit tree shaking.
The package also exposes read and write APIs, ABR/brush handling, metadata
handling, smart-object related structures, and a bundled browser build. A PSD
import path should use a lazy dynamic import so normal PNG, spritesheet, GIF,
APNG, Piskel, OpenRaster, Krita, and Pixelorama workflows do not pay the PSD
parser cost up front.

Size needs a dedicated measurement in the dependency task. Near-current UNPKG
metadata for `30.2.0` listed approximately:

- `dist/`: 2.04 MB
- `dist-es/`: 1.1 MB
- `src/`: 528 kB
- `.v8-cache/`: 8.8 MB

Those are package file sizes, not final Vite production bundle sizes. The spike
must record actual production build impact with the pinned version and confirm
whether `.v8-cache/` is shipped into `node_modules` after install.

## Unsupported Features

`ag-psd` is not full Photoshop compatibility. Its own README calls out
unsupported or incomplete areas, including non-RGB read modes, some high bit
depth behavior, PSB/Large Document Format behavior depending on version,
animation, palettes, patterns, metadata fields, 3D effects, recent Photoshop
features, smart-layer filters, and incomplete text-layer behavior.

For this project, unsupported PSD features should be rejected before producing
`SpriteProject`:

- PSB or any document beyond the existing PSD MVP limits.
- Non-RGB color modes unless the adapter explicitly validates the library's
  conversion behavior and the product copy explains the result.
- 16-bit or 32-bit data unless a separate task defines a tested down-conversion
  policy.
- Timeline animation. A PSD import MVP should generate one `SpriteFrame`.
- Text layers, smart objects, adjustment layers, vector layers, masks, effects,
  groups, artboards, clipping, and non-normal blend modes.
- Missing or ambiguous raster pixel data.

The adapter must not rely on `ag-psd`'s default best-effort parsing as project
validation. It should set strict options where available, inspect every layer,
and reject unsupported structures with safe diagnostics.

## Untrusted File Risks

Parsing PSD files in the browser still processes untrusted binary input. Keeping
artwork local avoids upload risk, but it does not remove denial-of-service or
data handling risks.

Main risks:

- Large PSD dimensions or layer counts can allocate excessive `ImageData`.
- ZIP-compressed channels, PackBits RLE, thumbnails, and embedded linked-file
  data can amplify memory and CPU cost.
- Malformed section lengths, channel lengths, rectangles, or strings can expose
  parser bugs.
- A main-thread parse can freeze the UI.
- Library diagnostics or thrown errors could expose raw source details if passed
  through directly.

Required adapter safeguards:

- Read only user-selected local files; do not upload artwork or PSD bytes.
- Enforce project-level file size, dimensions, layer count, decoded pixel, and
  decoded byte caps before and after parsing.
- Use `skipCompositeImageData`, `skipThumbnail`, and `skipLinkedFilesData`.
- Prefer `useImageData: true`; use `useRawData` only if the pinned version is
  tested and it reduces peak memory.
- Set a lower `totalMemoryLimit` than the package default if the pinned version
  supports it.
- Parse in a Web Worker and terminate on timeout or cancellation.
- Convert only inspected supported raster layers into `SpriteProject`.
- Sanitize errors before displaying them in the UI.

## Future Spike Checklist

1. Allow package files only for the dependency spike: `package.json` and the
   lockfile, plus a narrow test fixture path if that task creates generated PSD
   fixtures.
2. Pin the exact `ag-psd` version and record `npm view` metadata, license,
   transitive dependencies, and production bundle delta.
3. Add tiny generated PSD fixtures covering one raster layer, two raster layers,
   transparent pixels, offsets, hidden layers, opacity, unsupported text layer,
   unsupported group, and malformed/truncated data.
4. Verify `readPsd(buffer, { useImageData: true, skipCompositeImageData: true,
   skipThumbnail: true, skipLinkedFilesData: true })` returns stable pixel data.
5. Verify strict rejection of unsupported features instead of silent best-effort
   conversion.
6. Verify browser behavior in a worker, including cancellation and memory caps.

