# Architecture

## Main idea

Every input format is converted into a shared internal model called `SpriteProject`.

Every output format is generated from `SpriteProject`.

```text
PNG sequence       -> SpriteProject -> .aseprite
Spritesheet grid   -> SpriteProject -> .aseprite
Spritesheet + JSON -> SpriteProject -> .aseprite
Piskel             -> SpriteProject -> .aseprite
GIF/APNG           -> SpriteProject -> .aseprite
```

## Layers

Flat formats such as spritesheets, PNG sequences, and GIFs do not contain original layer information.

For these formats, create a single layer by default.

Layer preservation is only possible when the source format contains layer data.

## Core modules

Suggested structure:

```text
src/
├─ core/
│  ├─ SpriteProject.ts
│  ├─ validation/
│  ├─ importers/
│  │  ├─ pngSequence/
│  │  ├─ spritesheetGrid/
│  │  └─ spritesheetJson/
│  └─ exporters/
│     └─ aseprite/
├─ app/
│  ├─ components/
│  └─ routes/
└─ tests/
```

## Binary writer policy

The `.aseprite` writer must start with a minimal supported subset:

- RGBA 32-bit
- Normal layers
- Normal cels
- Multiple frames
- Frame duration
- Layer names
- zlib-compressed cel image data if required by the format

Do not add advanced features until the minimal writer has tests.

## Browser-only policy

The web app must not upload user files.

Acceptable:

- FileReader
- Blob
- Canvas API
- createImageBitmap
- Web Workers
- JSZip for local ZIP generation

Avoid:

- Uploading artwork to a server
- Server-side conversion
- Remote image processing APIs
