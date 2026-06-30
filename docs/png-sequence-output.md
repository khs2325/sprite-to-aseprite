# PNG Sequence Output Plan

Status: planning only. Do not implement PNG export, `.aseprite` input, UI
controls, or zip packaging from this note alone.

PNG sequence output is the first planned non-Aseprite export target. It should
export one flattened PNG per `SpriteProject` frame after any importer, including
a future `.ase` or `.aseprite` reader, has converted source data into the shared
model.

## Browser-Local Boundary

All output generation must stay browser-local:

```text
browser-selected source file
  -> importer or future Aseprite reader
  -> validated SpriteProject
  -> flattened frame compositor
  -> PNG Blob objects and optional metadata Blob
  -> local browser download
```

The PNG sequence exporter must consume only `SpriteProject`. It must not inspect
raw Aseprite chunks, source `File` objects, parser state, local file paths, or UI
component state. No source artwork, rendered frame, manifest, or diagnostic data
may be uploaded to a server.

## Exported Frames

The exporter should validate the project before encoding:

- `colorMode` is `"rgba"`;
- canvas `width` and `height` are positive whole numbers within documented
  browser limits;
- frames are ordered, zero-based, contiguous timeline entries;
- each frame has a positive `durationMs`; and
- layers and cels satisfy the normal `SpriteProject` invariants.

Frame output order is timeline order: `project.frames[0]`, then
`project.frames[1]`, continuing through the last frame. File names may use
one-based display numbers, but the manifest should preserve the zero-based
`frameIndex` values.

Each PNG canvas should be exactly `project.width` by `project.height`. Missing
cels render as transparent pixels. Cels with offsets are composited at their
canvas-relative `x` and `y` positions and clipped to the canvas bounds. Visible
layers are composited in project layer order using normal source-over RGBA
compositing and layer opacity. Hidden layers are not included in the flattened
frame.

The output PNGs preserve rendered transparency, not editor structure. Fully or
partially transparent pixels should remain transparent in the encoded PNG, but
the exporter should not promise preservation of hidden RGB color values under
alpha if browser canvas encoding discards or normalizes them.

## Filename Convention

Use deterministic names that sort in timeline order:

```text
<base>-frame-0001.png
<base>-frame-0002.png
<base>-frame-0003.png
```

Rules:

- `<base>` comes from a safe project/export name when available, otherwise
  `sprite-project`.
- Strip path separators, control characters, leading dots, and characters that
  are invalid or awkward on common filesystems. Collapse whitespace to `-`.
- Use lowercase `.png`.
- Use one-based frame numbers for downloaded filenames.
- Pad the frame number to `max(4, digits(frameCount))` so lexical sorting keeps
  timeline order.
- Do not include frame duration, layer name, or tag name in the default PNG
  filename.

If a sanitized base name becomes empty, fall back to `sprite-project`. If two
outputs would collide, the exporter should treat that as an internal naming bug
because frame numbers are expected to be unique.

## Timing Metadata

PNG files do not provide a reliable, portable timeline duration channel for this
app's browser-only MVP. Frame timing should therefore be exported through an
optional companion JSON manifest, not embedded PNG text chunks.

Default manifest name:

```text
<base>-png-sequence.json
```

Recommended manifest shape:

```json
{
  "format": "sprite-to-aseprite/png-sequence-manifest",
  "version": 1,
  "width": 16,
  "height": 16,
  "frames": [
    {
      "frameIndex": 0,
      "file": "sprite-project-frame-0001.png",
      "durationMs": 100
    }
  ],
  "frameTags": [
    {
      "name": "Walk",
      "from": 0,
      "to": 3,
      "direction": "forward"
    }
  ]
}
```

The manifest should be generated from `SpriteProject` fields only. It may include
supported `frameTags` when the model contains them, but those tags are metadata
for tools that read the manifest. Tags do not change PNG output order, create
tag folders, or preserve Aseprite editor metadata.

If the user downloads PNG files without the manifest, frame durations and tags
are not preserved by the PNG sequence itself. Product copy should say that the
export converts frames to flattened PNG files and can optionally download timing
metadata.

## Layers And Tags

PNG sequence output is a flattened pixel export:

- Layer names, source layer count, editable layer boundaries, groups, masks,
  blend modes, linked-cel relationships, slices, palettes, user data, and color
  profiles are not represented in the PNG files.
- Visible supported layers contribute to each frame's flattened pixels.
- Hidden layers do not contribute to exported PNGs.
- A future `.aseprite` reader may preserve layers in `SpriteProject` when the
  source contains supported layer data, but this exporter still outputs flattened
  frames.
- Frame tags can be copied to the optional manifest only after the importer and
  model have tested support for those tags.

Do not describe this output as lossless or as preserving editable Aseprite
layers. A PNG sequence can be useful for engine pipelines and interchange, but
it cannot carry the full editing model.

## Browser Download Behavior

The implementation must not add a zip dependency for the initial PNG sequence
export.

For one-frame projects, the UI can download the single PNG `Blob` directly. For
multi-frame projects, browser behavior is less predictable because automatic
multi-file downloads may be blocked or require user permission. The first
implementation should provide:

- a generated list of per-frame download links using local object URLs;
- a `Download all frames` action that attempts sequential downloads only from an
  explicit user gesture;
- a separate optional manifest download link; and
- clear fallback behavior when the browser blocks multiple downloads.

If the File System Access API is available, a later enhancement may offer
directory export after explicit user permission. That path must remain optional
and browser-local, with the individual download fallback kept for other
browsers.

Object URLs should be revoked after use or when the export view is replaced.
Large projects should encode frames sequentially where practical so the browser
does not need to hold every encoded PNG `Blob` at once.

## Future Task Breakdown

1. Add a core flattened-frame compositor with tests for layer order, visibility,
   opacity, cel offsets, transparent backgrounds, clipping, and missing cels.
2. Add a PNG sequence exporter that consumes `SpriteProject`, validates limits,
   encodes each flattened frame to PNG, and returns named browser-local `Blob`
   records.
3. Add the optional JSON timing manifest generator with tests for frame order,
   durations, filenames, and supported frame tags.
4. Add UI download behavior for single PNG, per-frame links, sequential
   `Download all frames`, manifest download, object URL cleanup, and blocked
   multi-download fallback messaging.
5. Enable PNG sequence in the output selector only after exporter and UI tests
   pass.
6. Connect future `.ase` or `.aseprite` input to this exporter only through
   validated `SpriteProject` output from the reader.

Each task should keep core exporter logic independent from UI code and should
update product copy only for behavior that is implemented and tested.
