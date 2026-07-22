# Supported Formats Matrix

This matrix summarizes browser-local input support for converting documented
source subsets into `.aseprite` files. "Supported" means the app supports the
listed subset, not the whole source format. Unsupported source features are
rejected clearly or documented as omitted when they do not affect the converted
`SpriteProject`.

Artwork and metadata stay in the browser. The converter does not upload source
files to a server or send them to a remote image-processing service.

## Status Terms

| Status | Meaning |
| --- | --- |
| Supported subset | Available for conversion when the input matches the documented subset. |
| Planned | Intended future work, but not available as a user-facing conversion path yet. |
| Research-only | Notes, feasibility work, or fixtures may exist, but users should not treat it as supported conversion. |
| Unsupported | Rejected, omitted, or outside the converter's current model and tests. |

## Input Matrix

| Input | Status | Layer support | Animation support | Main documented subset and limitations |
| --- | --- | --- | --- | --- |
| PNG sequence | Supported subset | No source layer data. Creates one normal layer named `Main`. | Rebuilds one frame per PNG in supplied order. Uses configurable timing, defaulting to 100 ms. | Every PNG must be valid and share the same dimensions. Flat PNGs cannot recover original layers. |
| Spritesheet grid | Supported subset | No source layer data. Creates one normal layer named `Main`. | Rebuilds frames from regular grid cells in row-major or column-major order, defaulting to 100 ms per frame. | One PNG only. The configured frame size, rows, and columns must exactly cover the image. |
| Spritesheet PNG + JSON | Supported subset | No source layer data. Creates one normal layer named `Main`. | Rebuilds frames from JSON rectangles. Per-frame durations are supported and default to 100 ms. Supported Aseprite frame tags may be preserved. | Accepts the documented Aseprite-style `frames` array or object map. Rectangles must fit the PNG. The supported TexturePacker rotated and trimmed cases require complete, consistent metadata. Other atlas schemas, including Phaser multi-atlas JSON, are not converted. |
| Piskel `.piskel` | Supported subset | Preserves supported source layer names, order, visibility, opacity, and decoded RGBA cels when the `.piskel` source contains that data. | Rebuilds visible frames. Global FPS is converted to one duration for all frames. Hidden frames are skipped and remaining frames are reindexed. | Accepts the documented model-version-2 JSON shape with string-encoded layer records and embedded PNG chunks or legacy horizontal sheets. Per-frame source durations, unsupported model versions, unknown fields, invalid hidden-frame data, and malformed embedded PNGs are rejected. |
| OpenRaster `.ora` | Supported subset | Preserves supported normal PNG-backed raster layer names, order, visibility, opacity, offsets, and RGBA pixels. | Single-frame only. OpenRaster animation metadata is unsupported. | Accepts the documented ZIP subset with valid `mimetype`, `stack.xml`, and direct root raster layers. Groups, masks, effects, non-normal blend modes, nested stacks, animation, and flattened previews such as `mergedimage.png` are not used to recover layers. |
| Pixelorama `.pxo` | Supported subset | Preserves supported normal pixel layer names, order, visibility, opacity, and RGBA cel pixels. | Rebuilds supported frames and timing from Pixelorama frame durations and project FPS. | Accepts the documented ZIP `.pxo` subset with RGBA8 full-canvas cels. Tilemaps, effects, group/3D/audio layers, unsupported blend modes, linked cels, palettes, guides, reference images, and arbitrary editor metadata are unsupported. |
| Pixilart `.pixil` | Supported observed 2.7.0 subset | Preserves supported layer names, order, opacity, and decoded PNG cel pixels. The uncertain `active` field is not mapped to visibility. | Rebuilds frame-array order and millisecond `speed` timing. | Accepts the observed genuine Pixilart 2.7.0 `application/type/version/frames/layers/src` structure, stable `unqid` (or validated numeric `id` fallback), and `source-over` blending. Other versions, non-PNG/external payloads, non-normal blends, effects, groups, and ambiguous layer identity are unsupported. See [pixil-format.md](pixil-format.md). |
| Krita `.kra` | Supported minimal subset | Preserves supported 8-bit RGBA paint-layer names, order, visibility, opacity, offsets, and decoded pixels. | Single-frame only. Krita animation timelines are unsupported. | Accepts the documented ZIP subset with native paint-layer payloads and normal compositing. Masks, vector layers, animation, unsupported color depths or profiles, effects, flattened previews, and missing native layer data are unsupported. |
| GIF `.gif` | Supported subset | GIF does not provide editable source-layer data for this import path. Rebuilds frames on one generated layer. | Rebuilds supported frames, timing, transparency, offsets, and disposal behavior. | Accepts the documented GIF89a subset. Interlaced images, unsupported extensions, malformed streams, reserved disposal methods, unsafe dimensions, and partial-animation fallbacks are rejected. |
| APNG `.apng` or animated `.png` | Supported subset | APNG does not provide editable source-layer data for this import path. Rebuilds frames on one generated layer. | Rebuilds supported frame timing, offsets, alpha blending, and disposal behavior. | Accepts the documented RGBA8 APNG subset. Static PNGs in APNG mode, separate default-image APNGs, extra chunks, palettes, grayscale/RGB-only/16-bit images, Adam7 interlace, invalid CRCs, and partial-animation fallbacks are rejected. |
| PSD `.psd` | Supported subset for input. Broader Photoshop compatibility and PSD output remain separate planned or research-only work. | Preserves supported raster layer names, order, visibility, opacity, offsets, and decoded RGBA pixels when the PSD contains supported raster layer data. | Single-frame only. PSD timeline and video animation metadata are unsupported. | Accepts version-1 RGB 8-bit PSD files with direct normal raster layers. Text layers, smart objects, adjustment layers, effects, masks, groups, clipping, PSB files, non-RGB or non-8-bit documents, non-normal blend modes, linked files, embedded objects, and timeline animation are unsupported. A flattened composite image is not used to recover layers. |

## Flat-Image Layer Limitation

PNG sequences and spritesheets are flat images. They do not contain the original
layer structure, so the converter cannot recover original layers from these
sources. The MVP PNG import modes create one layer named `Main`. Layers can
only be preserved when the source format contains layer data and the
corresponding importer supports it.

GIF and APNG are also flat animation sources for this importer. They can
rebuild timeline frames, timing, transparency, offsets, and disposal behavior
inside a generated layer, but they do not preserve or recover editable source
layers.

