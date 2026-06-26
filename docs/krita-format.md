# Krita `.kra` Format Notes

Status: researched and fixture-backed for a future minimal raster importer.
No core importer or browser UI wiring is implemented yet.

Primary references:

- Krita manual `.kra` notes: https://docs.krita.org/en/general_concepts/file_formats/file_kra.html
- Krita KRA converter: https://github.com/KDE/krita/blob/master/plugins/impex/libkra/kra_converter.cpp
- Krita KRA XML tags: https://github.com/KDE/krita/blob/master/plugins/impex/libkra/kis_kra_tags.h
- Krita KRA XML save/load visitors:
  https://github.com/KDE/krita/blob/master/plugins/impex/libkra/kis_kra_savexml_visitor.cpp
  and
  https://github.com/KDE/krita/blob/master/plugins/impex/libkra/kis_kra_loader.cpp
- Krita native tile storage:
  https://github.com/KDE/krita/blob/master/libs/image/tiles3/kis_tiled_data_manager.cc
  and
  https://github.com/KDE/krita/blob/master/libs/image/tiles3/swap/kis_tile_compressor_2.cpp
- Krita 8-bit RGB channel order:
  https://github.com/KDE/krita/blob/master/libs/pigment/colorspaces/KoRgbU8ColorSpace.cpp

Krita `.kra` is Krita's native project format. It is a ZIP container, but it is
not a small interchange format like OpenRaster. The official manual describes
it as an internal format that can be renamed to `.zip` for inspection and says
`mergedimage.png` is a rendered preview. Source confirms the current loader
uses `maindoc.xml`, optional `documentinfo.xml`, previews, image-named layer
entries, annotations, resources, keyframes, animation metadata, audio, masks,
and several layer types.

## Container Identity

The fixture-backed subset treats these entries as required:

- `mimetype`: first ZIP entry, stored without compression, exactly
  `application/x-krita`.
- `maindoc.xml`: UTF-8 XML document. Krita code opens this internally as
  `root`, but the ZIP member name is `maindoc.xml`.
- `preview.png`: flattened thumbnail/preview. It is not source layer data.
- `mergedimage.png`: flattened rendered image. It is not source layer data.
- `{imageName}/layers/{filename}`: native paint-layer data referenced by each
  supported `<layer filename="...">`.
- `{imageName}/layers/{filename}.defaultpixel`: native default pixel bytes for
  that paint device.

Krita's container identity is the stored `mimetype` entry plus the
`IMAGE mime="application/x-kra"` attribute inside `maindoc.xml`. The researched
source does not require a `META-INF/manifest.xml` file for this subset. If a
future real Krita file contains a separate manifest-like entry, the importer
should ignore it unless fixture-backed semantics are added.

All ZIP names are case-sensitive UTF-8. Accept only stored or deflated entries,
reject encrypted entries, duplicate logical paths, absolute paths, path
traversal, backslashes, empty names, directories where files are required, and
unsupported compression methods.

## Supported Minimal Raster Subset

The future importer should initially accept only single-frame documents that
map directly to `SpriteProject`:

```ts
{
  width: image.width,
  height: image.height,
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

Accepted `maindoc.xml` shape:

- Root `<DOC>` with `editor="krita"` and `syntaxVersion="2.0"`.
- One `<IMAGE>` with `mime="application/x-kra"`, positive integer `width` and
  `height`, `colorspacename="RGBA"`, and no proofing/color-conversion metadata
  that would require profile transforms.
- One direct `<LAYERS>` child.
- `<LAYERS>` contains only direct self-closing `<layer>` elements with
  `nodetype="paintlayer"`.
- Each paint layer has a safe `filename` whose native payload is stored at
  `{imageName}/layers/{filename}`.
- `compositeop` is `normal` or omitted.
- `name` is preserved. If absent, use deterministic generated names.
- `visible` is `0` or `1`; default to visible only if the attribute is absent.
- `opacity` is an integer from `0` through `255`.
- `x` and `y` are signed integer cel offsets.
- Layer `colorspacename` is `RGBA`, matching the image color space.

Accepted native paint-device payload:

- Header exactly matching Krita tile format version 2:
  `VERSION 2`, `TILEWIDTH 64`, `TILEHEIGHT 64`, `PIXELSIZE 4`, and `DATA n`.
- Tile records use `x,y,LZF,size` headers.
- Fixture-backed positive support is limited to raw tile payloads where the
  first tile-data byte is `0`. A first byte of `1` means LZF-compressed tile
  data and must be rejected until LZF decoding is implemented and tested.
- Tile coordinates must be safe integers and must not require allocating
  outside the configured document and decoded-pixel limits.
- `.defaultpixel` must be exactly four bytes and transparent for the initial
  subset.

Despite the `RGBA` color-space id, Krita's unmanaged 8-bit RGB implementation
stores channel bytes as blue, green, red, alpha. The importer must convert
native BGRA bytes to browser `ImageData` RGBA. Do not pass native bytes through
unchanged.

`preview.png` and `mergedimage.png` may be decoded only for structural
validation or diagnostics. They must never be used to preserve or recover
layers because they are flattened previews.

## Unsupported Features And Rejection Behavior

Reject the entire file with a clear diagnostic for:

- Missing or incorrect `mimetype`, missing `maindoc.xml`, malformed XML,
  missing `<DOC>` or `<IMAGE>`, unsupported syntax version, or invalid canvas
  dimensions.
- `.krz`, old `maindoc.xml` syntax variants, old `root`-only assumptions,
  external stores, or any unresearched container layout.
- Any color space other than 8-bit `RGBA`, any `PIXELSIZE` other than `4`,
  embedded ICC/proofing metadata that requires color conversion, unsupported
  profile names, indexed color, CMYK, grayscale, 16-bit, or float depth.
- Any layer type other than direct `paintlayer`: group, vector/shape, file,
  reference image, clone, generator, filter/adjustment, selection, or unknown
  node types.
- Masks of any kind, nested `<LAYERS>`, non-empty child nodes under a supported
  layer, layer styles, effects, selections, locked/channel-disabled data,
  non-normal composite ops, pass-through, color labels with semantics, or
  unsupported metadata.
- Animation timelines, keyframe files, `keyframes` attributes, onion-skin or
  timeline-only semantics, storyboard/audio metadata, or multiple frames.
- Missing layer payloads, corrupt native tile payloads, compressed LZF tile
  payloads until implemented, non-transparent default pixels, tile headers with
  unsupported versions, unsafe tile coordinates, or decoded pixels exceeding
  allocation limits.
- Files that contain only `preview.png` or `mergedimage.png` and no supported
  paint-layer payloads. The diagnostic should state that flattened previews do
  not contain recoverable source layers.

The diagnostic should name the first unsupported feature and should not include
raw artwork bytes, ZIP member contents, stack traces, or user file paths beyond
safe archive member names.

This is not full Krita compatibility and is not lossless Krita conversion. It
can preserve layers only when the `.kra` source contains supported native
paint-layer data.

## Browser Validation Limits

Parsing must remain browser-local. Do not upload `.kra` files or extracted
artwork.

Recommended initial limits before allocation:

- ZIP file size: 25 MiB.
- `maindoc.xml` uncompressed size: 5 MiB.
- Total uncompressed ZIP bytes read: 64 MiB.
- ZIP entry count: 512.
- Canvas width and height: `1..1024`.
- Paint layers: `1..64`.
- Frames: exactly `1` for this subset.
- Native tile records per layer: `1..1024`.
- Decoded pixel bytes after BGRA-to-RGBA conversion:
  `width * height * 4 * layers <= 64 MiB`.
- Layer names, filenames, profile names, and other XML attribute values:
  1024 UTF-16 code units each.

Validate all dimensions, counts, tile sizes, and multiplications with safe
integers before allocating `ArrayBuffer`, `Uint8Array`, `ImageData`, or
decompressed ZIP buffers.

## Fixture Strategy

Fixtures are generated by `tests/fixtures/generate.mjs` and contain only local,
synthetic pixels:

- `tests/fixtures/krita/two-paint-layers.kra` is the positive structural
  fixture. It covers stored `mimetype`, `maindoc.xml`, two `paintlayer`
  records, source order, names, visibility, opacity, signed offsets, normal
  composite op, `RGBA` color metadata, native tile format version 2, raw tile
  payloads, transparent default pixels, `preview.png`, and `mergedimage.png`.
- `tests/fixtures/krita/unsupported-vector-layer.kra` uses
  `nodetype="shapelayer"` for layer-type rejection.
- `tests/fixtures/krita/unsupported-color-depth.kra` uses `RGBA16` at image and
  layer level for color-depth rejection.
- `tests/fixtures/krita/missing-layer-data.kra` references two layer payloads
  that are intentionally absent.
- `tests/fixtures/krita/flattened-preview-only.kra` contains flattened previews
  but no source layer payloads.

Fixture tests inspect archive structure, XML attributes, PNG preview
dimensions, native tile headers, raw tile flags, default pixels, and BGRA bytes.
They do not implement Krita conversion.
