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

## Planned post-MVP compatibility work

The next planned work expands the existing browser-local architecture without
claiming support before implementation is tested:

1. TexturePacker trimmed frames, followed by rotated frames and clearer atlas
   format diagnostics.
2. Optional SpriteProject frame tags are mapped from supported Aseprite JSON.
   Encoding those tags in `.aseprite` output remains a separate planned writer
   change.
3. GIF has a core browser-local importer for the documented
   [supported subset](gif-format.md), with deterministic synthetic fixtures
   covering timing, transparency, offsets, disposal, and malformed streams.
   Browser UI wiring remains planned. APNG has a core browser-local importer for
   its documented [supported subset](apng-format.md), with deterministic
   synthetic fixtures covering timing, offsets, alpha blending, and disposal.
   APNG browser UI wiring remains planned.

Flat atlas, GIF, and APNG sources do not provide editable source-layer data, so
these paths will rebuild frames on a generated layer rather than claim layer
recovery. All planned processing remains in the browser with no artwork upload
or server conversion.

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
