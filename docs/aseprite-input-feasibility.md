# LibreSprite/Aseprite `.ase` and `.aseprite` Input Feasibility

Status: researched only. Recommendation: feasible later, but only after
fixture-backed binary-reader work is explicitly scoped.

Research date: 2026-06-27.

Primary references:

- Aseprite file format specification:
  https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
- LibreSprite project repository:
  https://github.com/LibreSprite/LibreSprite
- Existing project architecture: [architecture.md](architecture.md)
- Existing product wording policy: [product-spec.md](product-spec.md)

## Recommendation

Do not implement `.ase` or `.aseprite` input in this task. Keep this as a
research note until deterministic fixtures exist for the exact reader subset.

Input support is feasible because the Aseprite specification documents a
chunked little-endian binary format with explicit headers, frame records, layer
chunks, cel chunks, palette chunks, tag chunks, and zlib-compressed image
payloads. The same implementation must be treated as a new binary parser, not
as an extension of the existing exporter. It needs strict structural validation
before any decoded pixels become a `SpriteProject`.

The first supported path should be a minimal, browser-local reader that imports
only documented raster data into `SpriteProject`. It should not claim
round-trip fidelity. A file opened and then exported by this app would be a new
`.aseprite` file generated from `SpriteProject`; unsupported source metadata
could be dropped or rejected depending on the documented subset.

`.ase` and `.aseprite` should be treated as the same file-format family. The
extension alone does not prove whether a file was written by Aseprite,
LibreSprite, or another tool.

## Minimum Viable Chunk Subset

The minimum reader can start smaller than the full format. It should parse the
container enough to reject unsupported files safely, then construct a
`SpriteProject` only when every required feature maps cleanly.

### Required structure

- File header:
  - Validate the 128-byte header, file size, magic `0xA5E0`, frame count,
    width, height, color depth, header flags, deprecated global speed, and
    indexed transparent palette entry.
  - Use frame durations from frame headers when present; use the deprecated
    speed field only as the documented fallback for old files.
  - Initially accept only 32-bpp RGBA. Indexed and grayscale support should be
    separate follow-up tasks because they require palette or color conversion
    semantics.
- Frame headers:
  - Validate frame byte size, magic `0xF1FA`, old/new chunk counts, and frame
    duration.
  - Each accepted frame becomes one `SpriteFrame`.
- Chunk envelope:
  - Validate every chunk size is at least 6 bytes, stays inside the containing
    frame, and is fully consumed before advancing.
  - Unknown chunk types should be rejected in the first reader. Later tasks may
    allow documented safe skipping for non-rendering metadata.

### Layers: chunk `0x2004`

Layer chunks define layer order and indexes. The first reader should accept
only direct normal image layers:

- Layer type `0` only.
- Child level `0` only.
- Normal blend mode `0` only.
- Visible flag mapped to `SpriteLayer.visible`.
- Layer name mapped to `SpriteLayer.name`.
- Layer opacity mapped to `SpriteLayer.opacity` only when the header flag says
  layer opacity is valid; otherwise default to fully opaque.
- Optional layer UUID may be parsed and ignored because `SpriteProject` has no
  UUID field.

Reject group layers, tilemap layers, nested child levels, non-normal blend
modes, reference layers, and any layer feature that would require hierarchy,
compositing, or tile semantics.

### Cels and image data: chunk `0x2005`

Cel chunks supply the actual layer/frame pixels and placement:

- Validate the cel layer index exists and references an accepted layer.
- Map cel `x` and `y` to `SpriteCel.x` and `SpriteCel.y`.
- Accept compressed image cels, cel type `2`, as the first pixel path.
- Decompress zlib data only after checking expected width, height, color depth,
  and allocation limits.
- Require decompressed byte length to equal `width * height * bytesPerPixel`.
- Decode RGBA pixels directly to `ImageData`.
- Reject compressed tilemap cels, cel type `3`.

Raw image cels, cel type `0`, are documented but uncommon in modern files. They
can be added after compressed cels if fixtures prove the old-file behavior.

Linked cels, cel type `1`, can be supported later by copying or sharing the
target frame's decoded `ImageData` within the same layer. The reader must
validate that the target frame exists, the target cel exists, and there is no
cycle or unresolved forward reference. This preserves visible pixels but not
the source editor's linked-cel editing relationship, so product copy must not
claim round-trip fidelity.

The cel opacity byte is not directly representable in the current
`SpriteProject` model. The minimal reader should accept only fully opaque cels
unless a future task explicitly defines tested semantics, such as multiplying
cel alpha into the decoded pixels. Cel z-index is also not representable and
should be rejected unless it is zero.

### Frame tags: chunk `0x2018`

Tags are useful for Aseprite timeline workflows, but they are metadata beyond
the current canonical `SpriteProject` shown in `AGENTS.md`.

A future reader should parse tag chunks only when the project model and exporter
can preserve supported tag fields. The likely subset is:

- From frame and to frame.
- Loop direction.
- Repeat count.
- Name.
- Color, either from the deprecated RGB fields or the following user-data chunk
  when supported.

Until frame-tag import and export are both tested, files with tags should be
rejected or imported only under a clearly documented "tags not preserved"
policy. They must not be silently dropped while implying migration fidelity.

### Palettes: chunks `0x2019`, `0x0004`, and `0x0011`

The new palette chunk `0x2019` is the authoritative palette source when
present. Old palette chunks `0x0004` and `0x0011` exist for compatibility and
should be ignored when `0x2019` is present.

For the initial RGBA-only reader, palette chunks can be syntactically validated
and ignored because RGBA cels carry direct pixel values. This should be
documented as palette metadata not being preserved.

Indexed color input should be a later task. It requires:

- A valid palette covering all used indexes.
- Transparent-index handling for non-background layers.
- Old palette fallback behavior when no new palette chunk exists.
- Conversion from indexed pixels to RGBA `ImageData`.
- Fixtures from both Aseprite and LibreSprite.

### Color profiles: chunk `0x2007`

Color profiles affect interpretation, not layout. The minimal reader should
accept only no-profile or plain sRGB cases that match browser `ImageData`
behavior closely enough for the documented subset.

Reject embedded ICC profiles, special fixed gamma, grayscale profiles, or any
profile-dependent conversion until a browser-local color-management strategy is
researched and tested.

## Unsupported Chunks and Metadata

The first reader should reject source features that can affect rendered pixels,
layer structure, or editing semantics and cannot be represented in
`SpriteProject`.

Reject:

- Tilemap layers, compressed tilemap cels, and tileset chunks `0x2023`.
- External files chunk `0x2008`, especially external palettes, tilesets, or
  extension-owned properties.
- Group layers, nested layer child levels, pass-through or group opacity
  semantics, and non-normal blend modes.
- Nonzero cel z-index, non-opaque cel opacity, or cel extra chunk `0x2006` with
  precise/scaled bounds.
- Mask chunk `0x2016`, path chunk `0x2017`, and slice chunk `0x2022` if the
  importer is expected to preserve editor metadata.
- User-data chunk `0x2020` with extension properties or fields attached to
  layers/cels when those properties are not represented.
- Indexed or grayscale sprites until explicit conversion tasks exist.
- Color profiles requiring ICC or gamma conversion.
- Any malformed, duplicate, out-of-order, or unsupported chunk that would force
  guessing.

Known non-rendering metadata can be ignored only when all of these are true:

- The chunk is syntactically valid and fully bounded by its frame.
- No supported chunk references it.
- Ignoring it cannot change decoded pixels, layer order, frame durations, or
  supported tags.
- The importer diagnostic or format docs clearly state that the metadata is not
  preserved.

## Validation Needs

Binary input must fail closed. A future parser should validate before
allocation, decompression, or `ImageData` creation.

Required validation:

- Actual byte length must match the file-size field.
- Frame and chunk byte ranges must be monotonic and inside the file.
- Chunk counts must match the old/new frame header rules.
- Strings must fit inside their chunk and decode as UTF-8.
- Dimensions, frame count, layer count, cel count, and decoded pixel bytes must
  stay under project-defined browser limits.
- Multiplication for sizes such as `width * height * 4` must be checked for
  overflow and excessive allocation.
- zlib output must have the exact expected byte length and must not continue
  after the expected image payload.
- Layer chunks must define a stable layer index order before cels reference
  those layers.
- A frame/layer pair must not define duplicate independent cels unless a
  documented Aseprite behavior is implemented.
- Frame durations must be positive after fallback and within the exporter-safe
  range.
- Tag frame ranges must be inside the frame count and have `from <= to`.
- Palette ranges and indexed pixel values must be in bounds before indexed
  support is enabled.
- Diagnostics must not include artwork bytes, decompressed data, stack traces,
  or local user paths.

The parser should be independent from UI code and should output `SpriteProject`
only after all accepted structures pass validation.

## Compatibility Risks

Aseprite and LibreSprite are related but not identical compatibility targets.
LibreSprite originated as a GPL fork of Aseprite and has developed
independently. Aseprite has continued adding format features such as newer
palette behavior, UUID flags, user data, external files, tilemaps, tilesets, and
extension properties.

Risks:

- There is no simple extension-level compatibility signal. `.ase` and
  `.aseprite` can contain different chunk combinations depending on writer and
  version.
- Aseprite v1.1-era files may include both old and new palette chunks for
  backward compatibility.
- Newer Aseprite files may contain tilemaps, tilesets, UUIDs, external files,
  extension properties, or user data that LibreSprite-era expectations do not
  cover.
- LibreSprite fixtures may expose older or divergent writer behavior, including
  old palette chunks or raw image cels.
- Indexed and grayscale files need conversion into RGBA `ImageData`; this can
  change palette identity even when pixels are visually preserved.
- Color-profile behavior may differ from browser canvas assumptions.
- Opening and exporting through this app rewrites the file through the existing
  Aseprite exporter subset, so metadata and unsupported editing semantics are
  not round-tripped.

Compatibility should therefore be chunk-driven and fixture-driven, not based on
the filename extension or tool branding.

## Future Task Breakdown

1. Deterministic fixture research:
   - Generate tiny `.ase` and `.aseprite` files from pinned Aseprite and
     LibreSprite versions.
   - Cover one RGBA layer, two RGBA layers, hidden layer, layer opacity, two
     frames with distinct durations, compressed cels, old/raw cel data if
     available, linked cels, tags, indexed palette data, and intentionally
     malformed files.
   - Record the writer version and expected decoded `SpriteProject` shape.
2. Minimal binary reader scaffold:
   - Add a bounded little-endian reader, header parser, frame parser, chunk
     envelope validation, and safe diagnostics.
   - Keep it independent from UI code.
3. Minimal RGBA importer:
   - Support only direct normal layers, frame durations, and compressed RGBA
     image cels.
   - Reject unsupported chunks clearly.
   - Add binary-parser and importer tests before UI work.
4. Compatibility expansion:
   - Add raw image cels.
   - Add linked cels with documented loss of link-editing semantics.
   - Add frame tags only after `SpriteProject` and exporter support are
     fixture-backed.
   - Add indexed palette conversion only after old/new palette fixtures exist.
5. Browser UI wiring:
   - Add `.ase`/`.aseprite` input only after core tests pass.
   - Keep all processing browser-local with no upload path or remote
     conversion.
   - Use precise wording: convert supported frames, rebuild timeline, and
     preserve layers when the source contains supported layer data.

Do not modify the existing exporter as part of feasibility work. Exporter
changes should remain separate tasks with their own fixtures and tests.
