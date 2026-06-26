# Sprite to Aseprite Converter

Sprite to Aseprite Converter rebuilds editable Aseprite timelines from
sprite-related files. It converts frames into a `.aseprite` file; it does not
reconstruct information that is absent from the source.

## Supported inputs

The current conversion core supports:

- **PNG sequence:** each PNG becomes one frame, in the order supplied. Every
  image must have the same dimensions. Frames use a configurable duration,
  with a default of 100 ms.
- **Spritesheet grid:** one PNG is divided using an exact frame width, frame
  height, row count, and column count. Row-major and column-major frame order
  are supported. The configured grid must cover the entire image.
- **Spritesheet PNG + JSON:** accepts the documented Aseprite-style JSON subset
  where `frames` is an array or object map and each frame has an
  `x`, `y`, `w`, and `h` rectangle. Per-frame durations are supported and
  default to 100 ms when omitted. Frames must be contained within the PNG.
  TexturePacker frames using the common 90-degree clockwise atlas convention
  are restored when `rotated` is `true`. Trimmed frames are rebuilt on
  transparent full-size canvases when complete, consistent `sourceSize` and
  `spriteSourceSize` placement metadata is present.
- **Piskel project:** accepts exactly one model-version-2 `.piskel` file in the
  [documented supported subset](docs/piskel-format.md). It converts embedded
  PNG chunk frames and preserves supported source layer names and order,
  opacity/visibility, global-FPS timing, transparency, and decoded RGBA pixels.
  Hidden Piskel frames are skipped and remaining visible frames are reindexed
  because the output model does not preserve hidden-frame state. For
  compatibility with real Piskel exports, `"hiddenFrames": ""` is treated as no
  hidden frames and empty-string array entries are ignored.
- **OpenRaster project:** accepts exactly one `.ora` file in the
  [documented supported subset](docs/openraster-format.md). It converts the
  single-frame OpenRaster canvas and preserves supported normal PNG-backed
  raster layer names, order, visibility, opacity, x/y offsets, and RGBA pixels
  when the `.ora` file contains that supported raster layer data.
- **Pixelorama project:** accepts exactly one `.pxo` file in the
  [documented supported subset](docs/pixelorama-format.md). It converts
  supported Pixelorama frames and preserves supported normal raster pixel layer
  names, order, visibility, opacity, timing, and RGBA cel pixels when the
  `.pxo` source contains supported raster data.
- **GIF animation:** accepts exactly one `.gif` file in the
  [documented supported subset](docs/gif-format.md). Supported frames, timing,
  transparency, offsets, and disposal behavior are rebuilt on one generated
  layer.
- **APNG animation:** accepts exactly one `.apng` file, or an animated `.png`
  file, in the [documented supported subset](docs/apng-format.md). Supported
  frames, timing, offsets, alpha blending, and disposal behavior are rebuilt on
  one generated layer.

These inputs rebuild a timeline from the extracted frames. Piskel, OpenRaster,
and Pixelorama support is limited to each documented subset and is not
described as universal, perfect, or lossless conversion. GIF and APNG support
is likewise limited to each documented subset. These flat animation formats do
not provide editable source layers, so the converter does not claim to preserve
or recover layers from them. OpenRaster groups, masks, effects, non-normal
blend modes, and animation metadata are not preserved. Pixelorama tilemaps,
effects, layer types outside the supported raster pixel subset, and non-normal
blend modes are not preserved. PSD and other JSON schemas are not currently
supported.

## Browser-only processing

Artwork and metadata are read and processed in the browser. Conversion and
`.aseprite` generation do not upload user files to a server or send them to a
remote image-processing service. The generated file is downloaded locally
using browser APIs. Selected files can be reviewed and removed before
conversion; GIF, APNG, OpenRaster, and Pixelorama sources use document-style
file cards, while PNG thumbnail previews and the spritesheet grid overlay use
browser-local object URLs that are released when no longer needed.

In spritesheet grid mode, the UI reads the selected PNG dimensions locally and
auto-calculates rows and columns from the current frame size. A responsive grid
overlay updates with the selected image and visible grid settings so slicing
can be checked before conversion. The preview reports image size, grid size,
frame size, and total frames. Editing rows or columns also recalculates frame
dimensions. Values snap to the nearest image divisors so the visible grid fits
exactly without leftover edge pixels.

## Flat-image limitations

PNG sequences and spritesheets are flat image formats. They contain rendered
pixels, not the original layer structure, so the converter **cannot recover
original layers from a flat PNG**. These importers create one normal layer
named `Main` and place one cel on it for each converted frame.

Layer names, visibility, opacity, and multiple layers can be written when a
source format contains that layer data and an importer preserves it. Supported
Piskel, OpenRaster, and Pixelorama inputs may contain supported layer data; PNG
sequences, spritesheets, GIF, and APNG do not. Conversion is therefore not
described as lossless or as restoring an original Aseprite file.

## Aseprite output support

Generated `.aseprite` files support the subset represented by the internal
`SpriteProject` model:

- 32-bit RGBA documents
- multiple frames and per-frame durations
- ordered frame tags with inclusive ranges and forward, reverse, or ping-pong
  playback directions
- normal image layers with names, visibility, and layer opacity
- one unlinked, compressed RGBA image cel per layer per frame
- cel positions within the document

The writer does not currently export:

- indexed-color or grayscale documents
- layer groups, tilemap layers, or non-normal blend modes
- linked cels, per-cel opacity, or custom cel z-index
- slices, palettes, tilesets, user data, or color profiles
- other advanced Aseprite chunks not listed in the supported subset above

Unsupported source features are not silently presented as preserved. For
example, the spritesheet JSON importer rejects unsupported rotation values and
trimmed frames with incomplete or impossible placement metadata.

## Development checks

```bash
npm run typecheck
npm run test
npm run build
```
