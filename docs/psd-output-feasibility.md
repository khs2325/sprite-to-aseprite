# PSD Output Feasibility

Status: researched only. Recommendation: feasible later for a narrow static
layered PSD subset; no-go for `.aseprite` to PSD round-trip fidelity.

Research date: 2026-06-30.

Primary references:

- Adobe Photoshop File Formats Specification:
  https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/
- Adobe PSD overview:
  https://www.adobe.com/creativecloud/file-types/image/raster/psd-file.html
- Aseprite save documentation:
  https://www.aseprite.org/docs/save/
- Aseprite export documentation:
  https://www.aseprite.org/docs/exporting/
- Existing bidirectional planning: [bidirectional-conversion.md](bidirectional-conversion.md)
- Existing output selector plan: [output-format-selector.md](output-format-selector.md)
- Existing product wording policy: [product-spec.md](product-spec.md)

## Recommendation

Implement PSD output only after the output selector and shared compositor work
are ready, and only as a browser-local binary writer for a minimal RGB 8-bit
layered subset. Do not position it as Aseprite-to-PSD round-trip conversion.

The first useful subset should export one static frame of a `SpriteProject` to
one PSD document, preserving supported layer names, order, visibility, opacity,
cel placement, and RGBA layer image data. This is practical because the PSD
container can store RGB 8-bit image data, layer records, layer opacity, layer
visibility flags, layer names, layer rectangles, and per-layer channel data.

Do not implement Photoshop animation or timeline metadata in the first PSD
writer. A `SpriteProject` timeline can be represented as separate static PSDs,
or as a deliberately labeled cel-stack interchange file, but neither output is
a real Photoshop frame animation. Product copy should say "export a layered PSD
for a frame" or "export supported layers to PSD", not "convert `.aseprite` to
PSD losslessly".

All processing must stay in the browser. The writer should consume
`SpriteProject`, generate bytes locally, wrap them in a `Blob`, and download
the file without uploading artwork.

## Minimal PSD Subset

The cautious target is:

- PSD version 1 with signature `8BPS`; no PSB / Large Document Format.
- RGB color mode, 8 bits per channel.
- One static canvas matching `SpriteProject.width` and `SpriteProject.height`.
- A flattened composite image for the exported frame, so viewers that rely on
  the merged image have a useful preview.
- One PSD layer per supported `SpriteLayer` cel in the exported frame.
- Normal blend mode only.
- Layer opacity mapped from `SpriteLayer.opacity` to the PSD opacity byte.
- Layer visibility mapped from `SpriteLayer.visible`.
- Layer names written as safe Pascal names plus Unicode layer-name records when
  longer or non-ASCII names are supported by the writer.
- Layer image data written as red, green, blue, and transparency channels from
  `SpriteCel.imageData`.
- Raw channel compression first. PackBits RLE can be a later size optimization
  after structural tests prove byte counts and compatibility.

The writer should reject projects that exceed documented PSD output limits
before allocation. Suggested initial limits should be at least as conservative
as existing PSD import limits: bounded dimensions, bounded layer count, bounded
total decoded layer pixels, and bounded output byte size.

## `SpriteProject` Mapping

Canvas mapping:

- `SpriteProject.width` and `height` become the PSD canvas size.
- `SpriteProject.colorMode` must be `"rgba"`.
- Indexed palette identity, grayscale mode, color profiles, pixel aspect ratio,
  guides, slices, and editor metadata are not represented.

Frame mapping:

- The first PSD output should choose exactly one `SpriteFrame`.
- `SpriteFrame.durationMs` is not written to the minimal PSD subset.
- `frameTags` are not written to the minimal PSD subset.
- Multi-frame export should be a separate task, probably as one PSD per frame
  or a ZIP of per-frame PSDs. A single PSD with Photoshop timeline resources is
  out of scope until those resources are separately researched and tested.

Layer and cel mapping:

- Preserve the supported `SpriteProject.layers` order and verify the resulting
  visual order with fixtures opened in Photoshop-compatible applications.
- If a layer has no cel for the exported frame, omit it or write an empty
  transparent layer only if the product requirement explicitly needs stable
  layer lists across frames.
- Map `SpriteLayer.name` to the PSD layer name. Duplicate names can be
  preserved; the writer should not invent uniqueness unless a target
  application requires it.
- Map `SpriteLayer.visible` to the PSD hidden flag.
- Map `SpriteLayer.opacity` directly to PSD opacity `0..255`.
- Use normal blend mode for every layer because `SpriteProject` does not store
  non-normal blend modes.
- Map `SpriteCel.x`, `y`, `imageData.width`, and `imageData.height` to a PSD
  layer rectangle when the rectangle is fully inside the canvas.
- Reject or explicitly crop out-of-canvas cels only after a separate task
  defines the policy. The first writer should avoid guessing.
- Preserve per-pixel alpha from `ImageData` in the transparency channel. Do not
  bake layer opacity into pixels.

## Unsupported Features

Unsupported output features must be documented as unsupported, not silently
implied by the `.psd` extension.

Do not write:

- Photoshop timeline, video, frame animation, onion-skin, or timeline duration
  metadata.
- Aseprite frame tags, slices, tilesets, tilemaps, masks, linked-cel editing
  relationships, cel z-index, per-cel opacity, layer UUIDs, user data, or raw
  chunk metadata.
- Layer groups, nested layers, pass-through group behavior, artboards, layer
  comps, clipping masks, vector masks, user masks, adjustment layers, text
  layers, smart objects, effects/styles, filters, or external linked files.
- Non-normal blend modes, blend ranges, knockout/protection flags, or
  Photoshop-specific compositing descriptors.
- Indexed, CMYK, Lab, grayscale, duotone, bitmap, multichannel, 16-bit, or
  32-bit output.
- ICC profile conversion, color-management metadata, palette preservation,
  thumbnails, guides, print settings, or application-private descriptors in the
  first writer.
- ZIP-compressed PSD channel data until a dependency and compatibility task
  justifies it.

If an input `.aseprite` file later contains unsupported features, an Aseprite
reader should either reject those features before producing `SpriteProject` or
state that they are not preserved. The PSD exporter cannot recover metadata
that never entered `SpriteProject`.

## Compatibility Risks

PSD is widely recognized, but the extension does not guarantee consistent
editing behavior across applications. Compatibility should be proven with
fixtures before enabling the output.

Risks:

- Photoshop, Photopea, GIMP, Krita, Affinity Photo, and other tools may differ
  in layer order, alpha-channel interpretation, hidden-layer behavior, Unicode
  names, and composite preview handling.
- Some applications rely on the flattened composite image even when layer data
  is present. A stale or missing composite can show the wrong preview.
- Some applications may rewrite PSDs and drop data they do not understand.
- PSD layer rectangles, channel byte counts, and section lengths are easy to
  get subtly wrong. A malformed writer may open in one tool and fail in
  another.
- Large sprite timelines can produce very large PSD files because per-layer
  channel data is planar and the minimal raw subset is uncompressed.
- A cel-stack encoding of several frames in one PSD may be useful to advanced
  users, but it is not a timeline. Other tools will see layers, not animation
  frames.

Required compatibility checks for a future implementation:

- Structural tests that parse the generated PSD and verify header fields,
  section lengths, layer count, layer rectangles, channel lengths, opacity,
  visibility, names, and composite image data.
- Pixel tests that round-trip generated fixture PSDs through a parser used only
  in tests or fixture tooling.
- Manual or automated fixture opening in at least Photoshop-compatible viewers
  that the product intends to mention.
- Tests for empty layers, hidden layers, transparent pixels, opacity, Unicode
  names, duplicate names, single-layer files, and multiple layers.

## Why Round Trip Is Not Lossless

Round-trip conversion is not guaranteed to be lossless because `SpriteProject`
is a normalized interchange model, not an archive of the original `.aseprite`
or PSD file.

Loss points include:

- Aseprite chunk ordering, writer version, UUIDs, user data, extension data,
  slices, palettes, color profiles, tilesets, tilemaps, masks, group behavior,
  non-normal blend modes, linked-cel relationships, per-cel opacity, cel
  z-index, and editor-only metadata are outside the minimal PSD subset.
- A PSD static frame export does not preserve frame durations, tags, animation
  direction, or timeline structure.
- Flattened source formats that were imported into `SpriteProject` do not
  contain recoverable source layers. PSD output can only preserve layers when
  the current `SpriteProject` contains supported layer data.
- Indexed or palette-based source artwork may have visually equivalent RGBA
  pixels, but palette identity and indexed editing behavior are not preserved.
- Photoshop-compatible applications may rewrite PSD internals when opening and
  saving, even if the visible pixels look correct.

The safe product promise is layered raster interchange for supported data. It
is not `.aseprite` to PSD fidelity, Photoshop project reconstruction, or a
future guarantee that PSD can be imported back into the same Aseprite timeline.

## Future Task Shape

1. Define the first user workflow: selected-frame PSD, first-frame PSD, or a
   clearly labeled per-frame batch. Do not start with Photoshop timeline
   metadata.
2. Add a small project-owned PSD writer or run a dependency spike in a task that
   explicitly allows package changes. This research task adds no dependency.
3. Add structural writer tests before UI wiring. Binary writer changes need
   fixture-backed tests.
4. Add compatibility fixtures for layer names, opacity, hidden layers,
   transparent pixels, cel offsets, and composite preview data.
5. Keep the UI disabled until the writer has browser-local Blob download
   behavior and clear unsupported-feature diagnostics.

