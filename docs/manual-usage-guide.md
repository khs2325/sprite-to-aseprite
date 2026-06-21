# Manual usage guide

Sprite to Aseprite Converter rebuilds an editable Aseprite timeline from PNG
frames or spritesheets. Your artwork stays in the browser. The app does not
upload source files to a server or send them to an external processing
service.

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
   use the file picker. Only `.png` and `.json` files are accepted.
3. Check that the app reports the source files are ready, then select
   **Convert to .aseprite**. Conversion happens browser-locally.
4. Review the rebuilt timeline and make any timing or layer-name changes.
5. Select **Download .aseprite**. The browser downloads
   `sprite-project.aseprite`; no generated file is uploaded.

Changing the import mode or selecting new source files clears the previous
conversion. If conversion fails, correct the reported source or settings issue
and select the files again.

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

1. Select **Spritesheet grid**.
2. Enter the frame width, frame height, row count, and column count as positive
   whole numbers.
3. Choose the frame order:
   - **Rows first** reads left to right across each row, then moves down.
   - **Columns first** reads top to bottom down each column, then moves right.
4. Add exactly one PNG. Do not add a JSON file.
5. Select **Convert to .aseprite**.

The configured grid must exactly cover the PNG: `frame width x columns` must
equal the image width, and `frame height x rows` must equal the image height.
Every grid cell becomes a frame with a default duration of 100 milliseconds.

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

## Download and open the result

The **Download .aseprite** button appears after conversion succeeds. Select it
after completing any timeline or layer-name edits. Open the downloaded file in
Aseprite to continue editing and save it under a different name if desired.
