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

## Planned post-MVP Piskel support

Piskel (`.piskel`) support is planned as a browser-local import path through
the canonical `SpriteProject` model and the existing Aseprite exporter. The
work is split into fixtures/format notes, a core importer, conversion
integration tests, browser UI wiring, and user documentation.

The supported subset must be explicit about model versions, nested layer
records, embedded PNG chunks/layouts, and global FPS-to-frame-duration
conversion. It should preserve layer names, order, opacity/visibility, frames,
timing, and cel pixels when those values are represented by the supported
`.piskel` source. It must reject malformed or unsupported data clearly rather
than silently inventing or dropping source structure.

This plan does not make `.piskel` a currently supported input. Documentation
may advertise support only after the importer, integration path, and browser UI
are implemented and verified. Artwork must never be uploaded or remotely
processed.

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
