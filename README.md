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
  default to 100 ms when omitted. Frames must be unrotated, untrimmed, the same
  size, and contained within the PNG.
- **Piskel project:** accepts exactly one model-version-2 `.piskel` file in the
  [documented supported subset](docs/piskel-format.md). It converts embedded
  PNG chunk frames and preserves supported source layer names and order,
  opacity/visibility, global-FPS timing, transparency, and decoded RGBA pixels.

These inputs rebuild a timeline from the extracted frames. Piskel support is
limited to the documented subset and is not described as universal, perfect,
or lossless conversion. GIF, APNG, Pixelorama (`.pxo`), PSD, and other JSON
schemas are not currently supported.

## Browser-only processing

Artwork and metadata are read and processed in the browser. Conversion and
`.aseprite` generation do not upload user files to a server or send them to a
remote image-processing service. The generated file is downloaded locally
using browser APIs.

## Flat-image limitations

PNG sequences and spritesheets are flat image formats. They contain rendered
pixels, not the original layer structure, so the converter **cannot recover
original layers from a flat PNG**. These importers create one normal layer
named `Main` and place one cel on it for each converted frame.

Layer names, visibility, opacity, and multiple layers can be written when a
source format contains that layer data and an importer preserves it. The
currently supported PNG-based inputs do not contain such data. Conversion is
therefore not described as lossless or as restoring an original Aseprite file.

## Aseprite output support

Generated `.aseprite` files support the subset represented by the internal
`SpriteProject` model:

- 32-bit RGBA documents
- multiple frames and per-frame durations
- normal image layers with names, visibility, and layer opacity
- one unlinked, compressed RGBA image cel per layer per frame
- cel positions within the document

The writer does not currently export:

- indexed-color or grayscale documents
- layer groups, tilemap layers, or non-normal blend modes
- linked cels, per-cel opacity, or custom cel z-index
- frame tags, slices, palettes, tilesets, user data, or color profiles
- other advanced Aseprite chunks not listed in the supported subset above

Unsupported source features are not silently presented as preserved. For
example, the spritesheet JSON importer rejects rotated and trimmed frames.

## Development checks

```bash
npm run typecheck
npm run test
npm run build
```
