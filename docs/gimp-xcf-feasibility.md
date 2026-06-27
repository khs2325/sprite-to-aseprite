# GIMP `.xcf` Feasibility Notes

Status: researched only. Recommendation: no-go for direct importer work.

Research date: 2026-06-27.

Primary references:

- GIMP XCF format documentation:
  https://developer.gimp.org/core/standards/xcf/
- OpenRaster specification home:
  https://www.openraster.org/
- OpenRaster file layout:
  https://www.openraster.org/baseline/file-layout-spec.html
- OpenRaster layer stack:
  https://www.openraster.org/baseline/layer-stack-spec.html
- Existing project OpenRaster subset: [openraster-format.md](openraster-format.md)

## Recommendation

Do not create an XCF importer task from the current information. Keep direct
`.xcf` import out of scope unless there is strong user demand after the
OpenRaster path is already working and verified.

The safe product recommendation for GIMP interchange should be OpenRaster
(`.ora`), not direct XCF parsing. GIMP's own XCF documentation describes XCF as
a living native format tied to GIMP internals, with GIMP's load/save code as the
ultimate reference. The same documentation says interchange is not the goal of
XCF and calls OpenRaster the generic interchange format for this use case.

This project can already describe OpenRaster as a browser-local, documented,
layered raster interchange path. It must not claim GIMP compatibility, full XCF
support, layer/effect preservation, or recovery of layers from a flattened
render.

## Why XCF Is Harder Than ORA

XCF is a native project format, not a small interchange container. The current
format documentation covers a pointer-based binary file with image, layer,
channel, vector, effect, hierarchy, level, and tile structures. It also points
reader authors back to GIMP's source code for the authoritative behavior.

Versioning is active. The documented history spans version 0 through version 25.
GIMP 2.10 introduced many layer modes, layer group masks, high-bit-depth
precision values, zlib tile compression, and 64-bit offsets. GIMP 3.0 added
multi-selection state, newer vector storage, text-layer font changes, layer
effects, and updated blend/composite spaces. GIMP 3.2 adds vector-layer,
link-layer, transform, and resource fields. A browser importer would need to
reject unknown or unresearched versions and properties rather than assume they
are ignorable.

Pixel storage is not PNG-per-layer. Layer and channel pixels are stored in
64-by-64 tile hierarchies addressed through 32-bit or 64-bit big-endian
pointers. Tile payloads may be uncompressed, RLE-compressed, or zlib-compressed.
RLE is byte-plane based and has edge cases around stream boundaries and
pathological expansion. A browser-local parser would need strict pointer,
offset, tile-count, decompression, and allocation validation before creating
`ImageData`.

The color model is broader than `SpriteProject`. XCF supports RGB, grayscale,
and indexed images. Modern XCF can store 8-bit, 16-bit, 32-bit, and floating
point precisions, gamma or linear encodings, and image profiles. Indexed
transparency behavior is also different from normal RGBA. Since `SpriteProject`
currently stores browser `ImageData` in RGBA only, any non-8-bit RGB subset
would require explicit conversion semantics and tests.

Layer semantics exceed this converter's model. XCF layers are rectangular pixel
buffers with offsets, visibility, opacity, layer modes, composite modes, blend
spaces, and optional masks. It also stores channels, selections, floating
selections, paths, text-layer data, vector layers, link layers, transforms,
groups, parasites, and GEGL-backed layer effects. Most of those have no
`SpriteProject` field and must be rejected if preserving their source meaning
matters.

XCF is not a clean sprite timeline source. The format documentation describes
layers and channels, but it does not provide a simple frame-duration/cel model
that maps to `SpriteFrame`. Treating layers as animation frames would be a GIMP
workflow convention, not a reliable XCF format guarantee. A direct importer
should not rebuild timelines from XCF unless a separately documented,
fixture-backed animation subset exists.

## Why OpenRaster Is Preferable

OpenRaster is explicitly specified for exchanging layered raster images between
editors. Its baseline container is a ZIP file with a `mimetype`, `stack.xml`,
layer data files under `data/`, a thumbnail, and a flattened `mergedimage.png`
preview. The layer stack is XML and can reference normal raster layer PNGs with
positions, names, visibility, opacity, and compositing metadata.

That shape is a better fit for this browser app:

- Existing ZIP, XML, and PNG validation patterns are already used by the
  OpenRaster subset.
- PNG-backed layer data decodes naturally into browser `ImageData`.
- Unsupported groups, masks, effects, non-normal blend modes, and animation can
  be rejected at the `stack.xml` level before expensive pixel work.
- GIMP users can export `.ora` for interchange while keeping their `.xcf` as the
  native editing file.

OpenRaster support is still not full GIMP project compatibility. It can only
preserve layers when the `.ora` source contains supported raster layer data.

## Possible Minimal XCF Subset

A minimal safe subset is possible in theory, but it is not recommended for an
implementation task yet. If revisited, the first follow-up should be a fixture
feasibility task, not an importer.

Candidate constraints:

- Accept only GIMP-authored raw `.xcf` files from explicitly pinned and
  fixture-backed GIMP versions.
- Accept only RGB 8-bit gamma data, or old XCF files where that precision is
  implicit.
- Accept only direct top-level raster layers with no group hierarchy.
- Accept only normal layer mode, default/normal composite behavior, supported
  visibility, opacity, and signed x/y offsets.
- Accept only layer pixel hierarchies whose tile dimensions, pointers, and byte
  counts are safe before allocation.
- Prefer RLE-only at first because contemporary GIMP writes it by default;
  accept zlib only if the project already has a safe browser-local decompressor
  with tests and no unexplained production dependency.
- Map the image to exactly one `SpriteFrame`, using each accepted XCF layer as a
  `SpriteLayer` with one cel at the layer offset.
- Synthesize opaque alpha for a valid bottom RGB layer without alpha only if the
  fixture-backed subset proves the behavior.

The subset would still need clear rejection for unsupported data instead of
flattening or guessing.

## Required Rejections

Reject the entire file with a clear diagnostic for:

- Any XCF version, property, or structure not covered by fixtures.
- CinePaint XCF or any non-GIMP variant.
- Compressed wrapper files such as `.xcf.gz`, `.xcf.bz2`, or `.xcf.xz` unless a
  separate browser-local wrapper decompression strategy is researched and
  tested.
- Grayscale, indexed, high-bit-depth, floating-point, or profile-dependent
  color data.
- Non-normal layer modes, non-default composite or blend spaces, pass-through,
  dissolve, and GEGL-dependent rendering behavior.
- Layer masks, group masks, channels, selections, floating selections, paths,
  text layers, vector layers, link layers, transforms, effects, parasites, and
  unpreserved metadata.
- Any animation, multi-page, timing, or layer-name convention that is not a
  documented XCF frame model.
- Invalid pointer ordering, unsafe offsets, duplicate or cyclic structures,
  malformed property lengths, tile data outside the file, unsupported
  compression, decompression overflow, or decoded pixel sizes beyond browser
  limits.

Diagnostics must not include artwork bytes, raw decompressed data, stack traces,
or local user paths.

## Future Task Decision

Do not create future XCF importer, fixture, UI, or dependency tasks now. Keep
the roadmap focused on OpenRaster for GIMP interchange.

Revisit XCF only if all of the following become true:

- Users specifically need direct `.xcf` import after `.ora` import is available.
- The requested support can be limited to a small, documented raster subset.
- Synthetic, deterministic fixtures can be generated from pinned GIMP versions
  without storing user artwork.
- The implementation can remain fully browser-local without shelling out to
  GIMP, uploading files, or adding server conversion.
- The product copy can stay precise: convert supported frames and preserve
  layers only when supported source layer data exists.
