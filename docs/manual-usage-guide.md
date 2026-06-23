# Manual usage guide

Sprite to Aseprite Converter rebuilds an editable Aseprite timeline from PNG
frames, spritesheets, or a supported Piskel project. Your artwork stays in the
browser. The app does not upload source files to a server or send them to an
external processing service.

PNG sequences and spritesheets are flat images. They do not contain the
original layer structure, so the converter cannot recover original layers
from these sources. The MVP PNG import modes create one layer named `Main`.
Layers can only be preserved when the source format contains layer data and
the corresponding importer supports it.

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
   use the file picker. The app accepts `.png`, `.json`, and `.piskel` files;
   each mode validates its required file combination. Review the selected-file
   cards before conversion. PNG cards include browser-local thumbnails, while
   JSON and Piskel cards show document details without displaying their raw
   contents. Remove individual files or use **Clear selected files** as needed.
3. Check that the app reports the source files are ready, then select
   **Convert to .aseprite**. Conversion happens browser-locally.
4. Review the rebuilt timeline and make any timing or layer-name changes.
5. Select **Download .aseprite**. The browser downloads
   `sprite-project.aseprite`; no generated file is uploaded.

Changing the import mode revalidates the current selected files. Selecting or
dropping a new set replaces the previous selection. Removing, clearing, or
replacing files clears any conversion that no longer matches the source. All
file cards and previews are created in the browser; artwork is never uploaded.

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
   columns, rows, and total frame count. Adjust rows or columns manually when
   needed; the visible values are used for conversion.
5. Select **Convert to .aseprite**.

The configured grid must exactly cover the PNG: `frame width x columns` must
equal the image width, and `frame height x rows` must equal the image height.
Every grid cell becomes a frame with a default duration of 100 milliseconds.
The overlay updates when the selected PNG or any grid value changes. A warning
appears when the frame size does not divide the image evenly, when settings
leave pixels outside the grid, or when the grid exceeds the image dimensions.

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
the PNG and have the same dimensions. Rotated or trimmed frames are rejected.

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
   source. Supported Piskel sources may contain multiple preserved layers.
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
remains browser-only; attaching a file to an external issue tracker is a
separate action and should only be done deliberately.
