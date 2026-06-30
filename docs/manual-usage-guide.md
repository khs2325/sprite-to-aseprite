# Manual usage guide

Sprite to Aseprite Converter rebuilds an editable Aseprite timeline from PNG
frames, spritesheets, a supported Piskel project, a supported OpenRaster
project, a supported Pixelorama project, a supported Krita project, or a
supported PSD project or GIF/APNG animation.
PSD support is limited to RGB 8-bit raster layers in one-frame PSD files.
Your artwork stays in the browser. Selected files are read by browser APIs for
conversion in the tab; the app does not upload source files to a project server
or send them to an external processing service. Downloads are generated locally
from the converted bytes. See
[privacy-browser-local.md](privacy-browser-local.md).
For a quick input-format matrix, see
[supported-formats.md](supported-formats.md). For a compact matrix of what
cannot be preserved, see
[conversion-limitations.md](conversion-limitations.md). For common conversion,
download, and Aseprite-open issues, see
[troubleshooting.md](troubleshooting.md).

PNG sequences and spritesheets are flat images. They do not contain the
original layer structure, so the converter cannot recover original layers
from these sources. The MVP PNG import modes create one layer named `Main`.
Layers can only be preserved when the source format contains layer data and
the corresponding importer supports it.

Bidirectional conversion is not guaranteed to be lossless. Aseprite, PSD, PNG
sequences, spritesheets, GIF, and APNG do not share the same layer, timing,
tag, palette, effects, groups, masks, or metadata features. A round trip may
therefore keep only the supported frame pixels, timing, layer data, and tags
that both the source path, `SpriteProject`, and the destination path can
represent. Flat formats still cannot recover original source layers.

## Run the app locally

From the repository root, install the development dependencies if necessary,
then start the Vite development server:

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal, normally
`http://localhost:5173`. Keep the terminal running while using the app. Stop
the server with `Ctrl+C`.

## Common conversion workflow

1. Under **Choose an import mode**, select the mode matching the source files.
2. Under **Add source files**, drag the required files onto the drop area or
   use the file picker. The app accepts `.png`, `.json`, `.piskel`, `.gif`,
   `.apng`, `.ora`, `.pxo`, `.kra`, and `.psd` files. Each conversion mode
   validates its required file combination. Review the selected-file cards
   before conversion. PNG cards include browser-local thumbnails, while JSON,
   Piskel, GIF, APNG, OpenRaster, Pixelorama, Krita, and PSD cards show
   document details without displaying their raw contents.
   Remove individual files or use
   **Clear selected files** as needed.
3. For supported conversion modes, check that the app reports the source files
   are ready, then select
   **Convert to .aseprite**. Conversion happens browser-locally.
4. Review the rebuilt timeline and make any timing or layer-name changes.
5. Select **Download .aseprite**. The browser downloads
   `sprite-project.aseprite`; no generated file is uploaded.

Changing the import mode revalidates the current selected files. Selecting or
dropping a new set replaces the previous selection. Removing, clearing, or
replacing files clears any conversion that no longer matches the source. All
file cards and previews are created in the browser; artwork is never uploaded.

## Optional support

The converter is free to use. A Support link may appear in the page header or
footer, and the Support section explains any configured donation providers.
Support is optional, not required for conversion, and does not unlock hidden
functionality. The GitHub Sponsors link is configured as a public placeholder
and can be cleared if the Sponsors page is not ready.

Only public external provider pages should be linked. Payment handling stays on
those provider pages; the converter does not collect credit card data, add a
payment backend, or upload artwork for conversion.

## Large files and browser memory

Conversion runs entirely in the browser, so the available memory depends on
the browser, operating system, device, and other open tabs. There is no single
file-size limit that is safe on every device. The app shows an advisory warning
when selected source files total at least 64 MiB or a PNG sequence contains 100
or more files. The warning does not block conversion, and staying below either
threshold does not guarantee that a conversion will fit in memory.

Compressed source size is not a reliable measure of working memory. A decoded
RGBA image needs approximately `width x height x 4` bytes. For example:

- one 1,024 x 1,024 frame needs about 4 MiB when decoded, so 100 such frames
  need about 400 MiB for frame pixels alone;
- 60 decoded 2,048 x 2,048 frames need about 960 MiB for frame pixels alone;
  and
- one decoded 8,192 x 8,192 spritesheet needs about 256 MiB even if its PNG
  file is much smaller.

Peak usage can be substantially higher than these estimates. The browser may
simultaneously retain compressed input files, decoded source images, canvas or
frame copies, the `SpriteProject` cel data, and the generated `.aseprite` blob.
A tab that runs out of memory may slow down, fail conversion, reload, or crash.
Layered formats multiply this cost by retained layer and cel data, so PSD and
future Aseprite input can need much more memory than a flat file with the same
canvas size. Archive-based formats can also expand far beyond their compressed
file size while they are parsed and decoded.

For architecture-level memory limits and future format risks, see
[browser-memory-limits.md](browser-memory-limits.md).

For large conversions:

- use an up-to-date 64-bit desktop browser and close other memory-heavy tabs or
  applications;
- reduce canvas dimensions, crop unused transparent space, or remove
  unnecessary frames before importing;
- split a long sequence into smaller projects or smaller batches when one
  conversion approaches the device's memory limit;
- avoid combining many animations into one very large spritesheet; and
- keep the original files and retry with a smaller input if conversion becomes
  unusually slow or the tab reloads.

All of these operations remain browser-local. The app does not upload artwork
or use an external processing service to work around memory limits.

## PNG sequence

Use this mode when each animation frame is a separate PNG.

1. Select **PNG sequence**.
2. Add one or more PNG files together, in the intended frame order. Do not add
   a JSON file.
3. Select **Convert to .aseprite**.

Every PNG must be valid and have the same width and height. Each image becomes
one frame in the order supplied, with a default duration of 100 milliseconds.
Use the preview timeline after conversion to confirm the order and adjust
individual durations if needed.

## Spritesheet grid

Use this mode for one PNG arranged as a regular grid with no metadata file.

1. Select **Spritesheet grid** and add exactly one PNG.
2. Enter the frame width and frame height as positive whole numbers. After the
   browser reads the PNG dimensions locally, the app calculates rows and
   columns using the whole frames that fit across and down the image.
3. Choose the frame order:
   - **Rows first** reads left to right across each row, then moves down.
   - **Columns first** reads top to bottom down each column, then moves right.
4. Review the browser-local grid overlay. Its accessible status reports the
   image dimensions, columns, rows, frame dimensions, and total frame count.
   Editing frame width or height recalculates rows and columns. Editing rows or
   columns recalculates frame width and height. The visible values are used for
   conversion.
5. Select **Convert to .aseprite**.

The configured grid must exactly cover the PNG: `frame width x columns` must
equal the image width, and `frame height x rows` must equal the image height.
Every grid cell becomes a frame with a default duration of 100 milliseconds.
The overlay and its dimension summary update when the selected PNG or any grid
value changes. When an entered value would leave edge pixels, the controls snap
to the nearest positive divisor of the image dimension so the grid fits
exactly. If two divisors are equally close, the larger divisor is used. A status
near the preview explains whether the values were adjusted or already formed
an exact fit. Invalid values leave the current grid unavailable until corrected.

## Spritesheet PNG + JSON

Use this mode when an Aseprite-style JSON file defines frame rectangles in a
spritesheet PNG.

1. Select **Spritesheet PNG + JSON**.
2. Add exactly one PNG and one JSON file together.
3. Select **Convert to .aseprite**.

The JSON must have a non-empty `frames` array or object map. Each frame needs
an `x`, `y`, `w`, and `h` rectangle under `frame`; it may also include a
positive integer `duration` in milliseconds:

```json
{
  "frames": [
    {
      "frame": { "x": 0, "y": 0, "w": 16, "h": 16 },
      "duration": 100,
      "rotated": false,
      "trimmed": false
    }
  ]
}
```

Array entries use array order; object-map entries use JSON property order.
Missing durations default to 100 milliseconds. All rectangles must fit inside
the PNG. TexturePacker's common 90-degree clockwise atlas convention is
supported with `"rotated": true`; orientation is restored before trim
placement. Other rotation values and conventions are rejected. Trimmed frames
are supported when each entry provides complete placement metadata:

```json
{
  "frame": { "x": 0, "y": 0, "w": 10, "h": 8 },
  "duration": 100,
  "rotated": true,
  "trimmed": true,
  "spriteSourceSize": { "x": 4, "y": 3, "w": 8, "h": 10 },
  "sourceSize": { "w": 16, "h": 16 }
}
```

The trimmed rectangle width and height must match the restored frame dimensions
(`frame.h` and `frame.w`, respectively, when rotated), and its declared
placement must fit inside the positive whole-number `sourceSize`. The importer
places the restored rectangle at that offset on a transparent full-size canvas.
Every resulting frame canvas must have the same dimensions. Missing, malformed,
negative, out-of-bounds, or inconsistent trim geometry is rejected rather than
treating the cropped atlas rectangle as a complete frame.

Aseprite JSON identified by an Aseprite `meta.app` value may also provide an
ordered `meta.frameTags` array. Each tag needs a non-empty, case-sensitive
`name`, inclusive zero-based `from` and `to` frame indexes, and a `direction`
of `"forward"`, `"reverse"`, or `"pingpong"`:

```json
{
  "meta": {
    "app": "https://www.aseprite.org/",
    "frameTags": [
      { "name": "Walk", "from": 0, "to": 3, "direction": "forward" },
      { "name": "Idle", "from": 4, "to": 5, "direction": "pingpong" }
    ]
  }
}
```

Tag order is preserved. Both indexes must reference imported frames, `from`
must not exceed `to`, and exact duplicate names are rejected. Supported frame
tags are retained in the browser-local `SpriteProject` conversion model and
encoded as Aseprite frame tags in the generated file. Tag colors, finite repeat
counts, ping-pong-reverse playback, and tag user data are not represented or
exported. Non-Aseprite atlas metadata is not interpreted as Aseprite frame tags.

### Atlas JSON detection and diagnostics

Format detection is browser-local and uses JSON structure plus fixed producer
signals such as `meta.app`; it does not use the JSON filename or a remote
service. The diagnostic classifier recognizes Aseprite JSON, TexturePacker
Array (`frames` array), TexturePacker Hash (`frames` object map), common
Phaser/Pixi-compatible root-frame atlases, and Phaser Multi-Atlas metadata
with a top-level `textures` array. These formats overlap structurally, so a
recognized family is diagnostic guidance, not a claim that every variant can
be converted.

The supported conversion path remains one PNG with one non-empty root-level
`frames` array or object map using the fields documented above. Phaser
Multi-Atlas files are recognized but not converted because their frame data is
nested under one or more atlas pages. The app reports this as an unsupported
variant. Invalid JSON syntax, a recognized format with missing or malformed
fields, and valid JSON with an unknown schema are reported separately.
Diagnostics name the family and structural problem when possible without
displaying source JSON, frame-map keys, source filenames, or stack traces.

## Piskel project

Use this mode for one `.piskel` file that matches the
[supported Piskel subset](piskel-format.md).

1. Select **Piskel project** under **Choose an import mode**.
2. Add exactly one `.piskel` file. Do not add PNG or JSON files separately;
   supported Piskel files contain their layer images as embedded PNG data.
3. Confirm that the app reports the Piskel file is ready, then select
   **Convert to .aseprite**. Reading, validation, PNG decoding, and conversion
   happen browser-locally; no artwork is uploaded.
4. Review the frame count, order, and durations in **Preview timeline** and the
   preserved source layers under **Layer names**. The timeline preview is not a
   pixel-image viewer.
5. Select **Download .aseprite** to download `sprite-project.aseprite`, then use
   the Piskel-specific Aseprite checklist below.

The importer supports UTF-8 JSON files with integer `modelVersion: 2` and the
documented string-encoded layer and embedded PNG chunk structure. It preserves
layer names and order, opacity/visibility, frames, timing, transparency, and
decoded RGBA pixels only when those values are represented by that supported
source subset. The harmless boolean `expanded` editor-state field is ignored,
and missing layer opacity defaults to fully opaque. Each layer must cover the
same complete frame range. The single
project FPS becomes one duration for every frame, calculated as
`clamp(round(1000 / fps), 1, 65535)` milliseconds; per-frame source durations
are not supported. Opacity from `0` through `1` is rounded to Aseprite's 8-bit
range. Missing layer visibility defaults to visible.

Hidden Piskel frames are accepted but omitted from the converted timeline,
because `SpriteProject` and the generated Aseprite output do not preserve a
hidden-frame state. Remaining frames keep their source order and are reindexed
from zero. Some Piskel exports serialize `hiddenFrames` as an empty string or
as an array containing empty-string entries. The converter ignores those exact
empty sentinels, so an array containing only one or more of them means no hidden
frames. Whitespace-only strings remain invalid. A non-empty top-level string is
rejected instead of being interpreted as a comma-separated format. Arrays
otherwise accept safe integer indexes and strict decimal index strings, while
duplicate normalized indexes are rejected. Other model versions, undocumented
fields, invalid, duplicate, or
out-of-range `hiddenFrames` indexes, an all-hidden timeline, ambiguous layers
containing both `chunks` and top-level `base64PNG`, external PNG URLs, malformed
or incomplete chunk layouts, and invalid or incorrectly sized embedded PNGs
are rejected. Legacy layers containing only top-level
`base64PNG` are accepted as horizontal frame sheets. Validation errors name the
first detected field, layout, coverage, or embedded-image problem without
showing source contents or stack traces.
The project name and description are validated metadata but are not exported;
internal layer ids are generated. These boundaries mean Piskel conversion is
not claimed to be universal, perfect, or lossless.

## OpenRaster project

OpenRaster import follows the
[documented supported OpenRaster subset](openraster-format.md).

1. Select **OpenRaster project** under **Choose an import mode**.
2. Choose exactly one `.ora` file.
3. Review the document-style file card, then select
   **Convert to .aseprite**. ZIP parsing, PNG layer decoding, validation, and
   conversion happen browser-locally; no artwork is uploaded.
4. Confirm the single rebuilt frame and inspect the preserved supported raster
   layers under **Layer names** before downloading.

The importer preserves supported layers only when the `.ora` file contains
supported normal PNG-backed raster layer data. It supports canvas dimensions,
source layer order, names, visibility, opacity, signed x/y offsets, and decoded
RGBA pixels for the documented single-frame subset. It does not preserve
OpenRaster animation, groups, masks, effects, non-normal blend modes, or
unsupported archive features. Unsupported or malformed data is rejected with a
safe diagnostic that does not display raw source contents or stack traces.

## Pixelorama project

Pixelorama import follows the
[documented supported Pixelorama subset](pixelorama-format.md).

1. Select **Pixelorama project** under **Choose an import mode**.
2. Choose exactly one `.pxo` file.
3. Review the document-style file card, then select
   **Convert to .aseprite**. ZIP parsing, JSON validation, raw cel reading, and
   conversion happen browser-locally; no artwork is uploaded.
4. Confirm the converted frames and inspect the preserved supported raster
   layers under **Layer names** before downloading.

The importer converts supported Pixelorama frames and preserves supported
layers only when the `.pxo` source contains supported raster pixel layer data.
It supports the documented ZIP `.pxo` subset with RGBA8 full-canvas cels,
normal pixel layers, layer names, layer order, visibility, opacity, and frame
timing. It does not preserve Pixelorama tilemaps, effects, unsupported layer
types, unsupported blend modes, linked cels, palettes, guides, reference
images, or other editor metadata. Unsupported or malformed data is rejected
with a safe diagnostic that does not display raw source contents or stack
traces.

## Krita project

Krita import follows the
[documented minimal Krita raster subset](krita-format.md).

1. Select **Krita project** under **Choose an import mode**.
2. Choose exactly one `.kra` file from the documented minimal raster subset.
3. Review the document-style file card, then select
   **Convert to .aseprite**. ZIP parsing, maindoc validation, native paint-layer
   reading, and conversion happen browser-locally; no artwork is uploaded.
4. Confirm the single rebuilt frame and inspect the preserved supported raster
   layers under **Layer names** before downloading.

The importer converts supported single-frame 8-bit RGBA Krita paint layers and
preserves supported layer names, order, visibility, opacity, signed x/y
offsets, and decoded RGBA pixels only when the `.kra` source contains that
supported paint-layer data. It does not preserve Krita masks, vector layers,
animation timelines, unsupported color depths or profiles, effects, or other
editor metadata. Flattened `preview.png` and `mergedimage.png` entries are not
used to recover source layers. Unsupported or malformed data is rejected with a
safe diagnostic that does not display raw source contents or stack traces.

## PSD project

PSD import follows the [documented supported PSD subset](psd-format.md).

1. Select **PSD project** under **Choose an import mode**.
2. Choose exactly one `.psd` file from the RGB 8-bit raster-layer subset.
3. Review the document-style file card, then select
   **Convert to .aseprite**. PSD parsing, raster-layer decoding, validation,
   and conversion happen browser-locally; no artwork is uploaded.
4. Confirm the single rebuilt frame and inspect the preserved supported raster
   layers under **Layer names** before downloading.

The importer converts supported one-frame RGB 8-bit PSD raster layers and
preserves supported layer names, order, visibility, opacity, offsets, and
decoded RGBA pixels only when the PSD source contains that supported raster
layer data. It does not provide full Photoshop compatibility. It does not
claim perfect or lossless PSD conversion, and it does not recover layers from a
flattened composite image.

Text layers, smart objects, adjustment or fill layers, layer effects, masks,
groups, clipping, PSB files, unsupported color modes or channel depths,
non-normal blend modes, animation timelines, linked files, embedded objects,
unsafe dimensions, and malformed channel data are not supported. Unsupported
features are rejected with a safe diagnostic or documented as omitted when they
do not affect the converted `SpriteProject`; they are not flattened into the
output as preserved source layers.

## GIF animation

GIF import follows the [documented supported GIF subset](gif-format.md).

1. Select **GIF animation** under **Choose an import mode**.
2. Choose exactly one `.gif` file.
3. Review the document-style file card, then select
   **Convert to .aseprite**.
4. Confirm the reported frame count and inspect timing, transparency, offsets,
   and disposal results in the rebuilt timeline before downloading.

The importer processes the selected file in the browser and reports a specific,
safe diagnostic when the stream is malformed or uses an unsupported GIF
feature. GIF does not contain editable source-layer structure for this import
path, so the converter rebuilds frames on one generated layer rather than
claiming layer preservation.

## APNG animation

APNG import follows the [documented supported APNG subset](apng-format.md).

1. Select **APNG animation** under **Choose an import mode**.
2. Choose exactly one `.apng` file or one animated `.png` file.
3. Review the selected file card, then select **Convert to .aseprite**.
4. Confirm the reported frame count and inspect timing, offsets, alpha blending,
   and disposal results in the rebuilt timeline before downloading.

A plain, non-animated PNG selected in APNG mode is rejected with an APNG
diagnostic. Processing remains browser-local. APNG does not provide editable
source-layer structure for this import path, so the converter rebuilds frames
on one generated layer rather than claiming layer preservation.

## Preview and edit the rebuilt timeline

After a successful conversion, **Preview timeline** lists every imported frame
and its duration. Select a listed frame, or use **Previous frame** and
**Next frame**, to inspect its position and timing in the timeline. To change
timing, enter a whole-number duration from 1 to 65,535 milliseconds and select
**Update duration**.

The preview is a timeline review rather than a pixel-image viewer. Check the
downloaded file in Aseprite when a visual inspection of frame pixels is
required.

Under **Layer names**, enter a non-empty name and select **Rename layer** to
change the generated layer name before downloading. Renaming this layer does
not recover layers that were absent from a flat PNG source.

## Manually verify the result in Aseprite

The **Download .aseprite** button appears after conversion succeeds. Select it
after completing any timeline or layer-name edits. Keep a note of the selected
import mode, expected frame order, and expected duration of each frame so the
download can be compared with the source.

1. In Aseprite, select **File > Open** and choose the downloaded
   `sprite-project.aseprite` file. Record the exact error message if Aseprite
   cannot open it.
2. In the timeline, confirm that the number and order of frames match the app's
   preview. Select each frame and compare its visible pixels with the
   corresponding PNG or spritesheet region.
3. For each frame, open **Frame Properties** from the frame's timeline context
   menu and compare its duration with the value shown in the app. Check every
   duration when testing a small file; for a large file, check the first, last,
   and every frame whose duration differs from the default.
4. Play the animation once to catch unexpected ordering, blank frames, or
   timing changes that are harder to notice one frame at a time.
5. Confirm the expected canvas dimensions and layer names. PNG sequences and
   spritesheets are flat sources, so one generated layer is expected; this
   check must not be treated as recovery of layers that were absent from the
   source. Supported Piskel, OpenRaster, Pixelorama, Krita, and PSD sources may
   contain multiple preserved layers.
6. Make a small edit and use **File > Save As** to a new file. Reopen that copy
   if editability is part of the compatibility check, leaving the downloaded
   file unchanged for comparison.

A successful check shows that this particular generated file opened and
matched the inspected frame data in the tested Aseprite version. It does not
prove lossless conversion or compatibility with every Aseprite version.

### Piskel-specific Aseprite checklist

For a Piskel conversion, compare the downloaded file with the source project:

- confirm the canvas width and height;
- confirm the frame count and zero-based source frame order;
- confirm hidden source frames are absent and the remaining visible frames are
  reindexed contiguously;
- confirm representative or all frame durations equal the rounded and clamped
  global-FPS conversion described above;
- confirm layer names and source array order, plus each layer's opacity and
  visible/hidden state (a missing source `visible` field defaults to visible);
- inspect transparent and partially transparent areas for correct alpha; and
- compare representative pixels in each layer and across the first, last, and
  any chunk-boundary frames.

Passing this checklist verifies the inspected supported source data, not
unsupported Piskel fields or variants.

### Pixelorama-specific Aseprite checklist

For a Pixelorama conversion, compare the downloaded file with the supported
source data:

- confirm the canvas width and height;
- confirm the frame count, order, and converted frame durations;
- confirm layer names and source order, plus each layer's opacity and
  visible/hidden state;
- inspect transparent and partially transparent areas for correct alpha; and
- compare representative pixels in each supported raster layer across the
  first, last, and any timing-sensitive frames.

Passing this checklist verifies the inspected supported `.pxo` raster data, not
unsupported Pixelorama tilemaps, effects, layer types, blend modes, or editor
metadata.

### Krita-specific Aseprite checklist

For a Krita conversion, compare the downloaded file with the supported source
paint-layer data:

- confirm the canvas width and height;
- confirm the single rebuilt frame;
- confirm layer names and source order, plus each layer's opacity,
  visible/hidden state, and x/y offset;
- inspect transparent and partially transparent areas for correct alpha; and
- compare representative pixels in each supported paint layer.

Passing this checklist verifies the inspected supported `.kra` raster data, not
unsupported Krita masks, vector layers, animation timelines, effects, color
profiles, flattened previews, or editor metadata.

### Report a compatibility problem

Include the following in a problem report:

- the converter revision or release, import mode, and conversion settings;
- the Aseprite version, operating system, and whether the file opened;
- source dimensions, expected frame count, and expected frame durations;
- the exact error message, or the affected frame numbers and the expected and
  observed result; and
- the smallest reproducible source and generated file that are safe to share.

Do not share private artwork to report a problem. A newly created minimal test
sprite is sufficient when it reproduces the issue. File processing by the app
remains browser-only; attaching a file to an external issue tracker, support
request, cloud drive, chat tool, or other service is a separate action governed
by that service and should only be done deliberately.
