# Product Spec

## Product name

Sprite to Aseprite Converter

## Goal

Create a static browser-based app that helps users convert sprite-related files into editable `.aseprite` files.

The tool should help users rebuild an editable Aseprite timeline from assets such as PNG sequences, spritesheets, and metadata JSON files.

## MVP scope

1. PNG sequence -> `.aseprite`
2. Spritesheet grid -> `.aseprite`
3. Spritesheet PNG + JSON -> `.aseprite`

## Non-goals for MVP

- Server-side file upload
- Cloud storage of user artwork
- PSD import
- Full layer recovery from flat PNG files
- Full `.aseprite` feature parity
- Auto-merge of AI-generated code

## Supported post-MVP Piskel import

Piskel (`.piskel`) is supported as a browser-local import path through the
canonical `SpriteProject` model and the Aseprite exporter. The implemented
path includes fixtures, an explicit [supported subset](piskel-format.md), a
core importer, conversion integration tests, browser UI wiring, and user
documentation.

The supported subset is explicit about model versions, nested layer
records, embedded PNG chunks/layouts, and global FPS-to-frame-duration
conversion. It preserves layer names, order, opacity/visibility, frames,
timing, and decoded cel pixels only when those values are represented by the
supported `.piskel` source. Malformed or unsupported data is rejected clearly
rather than silently inventing or dropping source structure.

This support is not universal, perfect, or lossless Piskel conversion. Artwork
is never uploaded or remotely processed.

## Supported post-MVP GIF and APNG import

GIF and APNG are supported as browser-local import paths through the canonical
`SpriteProject` model and the existing Aseprite exporter. The browser UI accepts
one `.gif` in the [documented GIF subset](gif-format.md), or one `.apng`/animated
`.png` in the [documented APNG subset](apng-format.md), and exposes safe
importer-authored diagnostics for malformed or unsupported files.

These flat animation sources rebuild supported frames and timing on a generated
layer. They do not provide editable source-layer data, so the product does not
claim layer preservation or recovery. Source artwork is processed locally in
the browser and is never uploaded.

## Supported post-MVP OpenRaster import

OpenRaster (`.ora`) is supported as a browser-local import path through the
canonical `SpriteProject` model and the existing Aseprite exporter. The browser
UI accepts exactly one `.ora` file and routes it to the documented
[OpenRaster format subset](openraster-format.md), covering a single-frame ZIP
container with `mimetype`, `stack.xml`, normal PNG-backed raster layers, canvas
dimensions, layer names, source order, visibility, opacity, signed x/y offsets,
and decoded RGBA pixels.

This support preserves layers only when the `.ora` source contains supported
raster layer data. It does not implement animation, groups, masks, effects,
non-normal blend modes, or full/lossless OpenRaster conversion. Artwork is
processed locally and is never uploaded.

## Supported post-MVP Pixelorama import

Pixelorama (`.pxo`) is supported as a browser-local import path through the
canonical `SpriteProject` model and the existing Aseprite exporter. The browser
UI accepts exactly one `.pxo` file and routes it to the documented
[Pixelorama format subset](pixelorama-format.md): ZIP `.pxo` files with RGBA8
raw cel data, normal pixel layers, supported frame timing, layer order, layer
names, visibility, opacity, and full-canvas cels.

This support preserves layers only when the `.pxo` source contains supported
raster pixel layer data. It rejects unsupported tilemaps, effects, blend modes,
layer types, missing image data, and ambiguous metadata clearly rather than
inventing semantics. The UI exposes safe importer-authored diagnostics without
stack traces or raw source contents. Artwork is processed locally and is never
uploaded.

## Supported post-MVP Krita core import

Krita (`.kra`) has a browser-local core importer for the documented
[Krita format subset](krita-format.md): single-frame 8-bit RGBA paint layers
with fixture-backed native raw tile payloads, normal compositing, layer names,
order, visibility, opacity, offsets, and decoded pixels.

This support is deliberately minimal and is not wired into the browser UI yet.
It rejects unsupported Krita features such as masks, vector layers, animation
timelines, unsupported color depths or profiles, effects, and missing native
paint-layer payloads. Flattened `preview.png` and `mergedimage.png` entries are
not used to recover source layers. Artwork is processed locally and is never
uploaded.

## Planned additional free/open art tool project formats

The next project-format roadmap continues to focus on small, deterministic,
browser-local subsets rather than broad compatibility claims:

1. GIMP `.xcf` is research-only at first because it is a living GIMP-native
   format tied closely to GIMP internals; OpenRaster may be the safer interchange
   recommendation.
2. LibreSprite/Aseprite `.ase` and `.aseprite` input is also research-only at
   first so binary reader scope, chunk coverage, validation, and round-trip
   limitations are understood before implementation.

For every planned format, the converter should rebuild timelines, convert
supported frames, and preserve supported raster layer data only when that data
exists in the documented source subset. It must not upload artwork, add
server-side processing, or imply lossless conversion for unsupported source
features.

## Planned post-MVP compatibility work

The next planned work expands the existing browser-local architecture without
claiming support before implementation is tested:

1. TexturePacker trimmed frames, followed by rotated frames and clearer atlas
   format diagnostics.
2. Optional SpriteProject frame tags are mapped from supported Aseprite JSON.
   Encoding those tags in `.aseprite` output remains a separate planned writer
   change.

Flat atlas sources do not provide editable source-layer data, so those paths
rebuild frames on a generated layer rather than claim layer recovery. All
planned processing remains in the browser with no artwork upload or server
conversion.

## Core user promise

User files stay in the browser whenever the web app processes artwork.

## Accurate wording policy

Allowed:

- "Convert frames into an editable Aseprite timeline."
- "Preserve layers when the source format contains layer data."
- "Rebuild animation frames from a spritesheet."

Not allowed:

- "Recover lost layers from a flat PNG."
- "Lossless conversion" unless proven by tests for that exact path.
- "Perfectly restores the original Aseprite file."
