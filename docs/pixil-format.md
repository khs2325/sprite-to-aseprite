# Pixil/Pixilart `.pixil` Supported Subset

Status: supported, fixture-backed subset. This is limited project-file import,
not full or lossless Pixil/Pixilart compatibility.

The browser UI accepts exactly one local `.pixil` file. The importer reads it
in the browser and does not upload the project, fetch external image data, or
send artwork to Pixilart or another processing service.

## Accepted Container

The file must be strict JSON with exactly one root field, `pixil`. The project
object must use:

- `format: "pixilart.com/pixil-project"`;
- `schemaVersion: 1`;
- integer `width` and `height` from 1 through 1024;
- `frameCount` and `layerCount` values matching non-empty `frames` and `layers`
  arrays; and
- no unknown fields at the root, project, frame, layer, or cel level.

This contract is proven by synthetic repository fixtures. It is not a claim
that every file named `.pixil`, or every Pixilart editor version, uses this
schema. Alternate containers and schema versions are rejected.

## Preserved Data

For an accepted project, the importer maps the following data into
`SpriteProject`:

- canvas width and height;
- explicit frame order and required positive `durationMs` values, normalized
  to the Aseprite-supported range of 1 through 65535 milliseconds;
- explicit layer order, non-empty layer names, visibility, and opacity from
  the source `0..1` range to `0..255`;
- normal blend mode; and
- exact row-major RGBA bytes for one full-canvas cel at `(0, 0)` for every
  layer/frame pair.

Layers are preserved only when the `.pixil` source contains this required,
supported layer data. A flattened preview or export is never used to recover
missing layers.

## Validation And Safety Limits

The importer rejects malformed or ambiguous projects rather than inventing
defaults. Current limits are:

- file size: 96 MiB;
- frames: 1 through 512;
- layers: 1 through 64;
- total cels: at most 4096;
- decoded raw cel data: at most 64 MiB; and
- strings: at most 1024 characters.

Frame and layer indexes must be unique, contiguous, zero-based, and match array
order. Every layer must contain exactly one cel for every frame. Raw pixel data
must be strict base64 that decodes to exactly `width * height * 4` bytes.

## Unsupported Features

The supported subset rejects or does not represent:

- alternate `.pixil` containers, schema versions, and unknown fields;
- missing, duplicate, sparse, or ambiguous frames, layers, or cels;
- partial-canvas cels, nonzero cel offsets, linked or shared cels, and external
  image URLs;
- blend modes other than normal;
- clipping masks, alpha lock, filters, effects, transforms, groups, tile
  features, reference images, tracing backgrounds, selections, and history;
- palettes or indexed pixels required to interpret artwork;
- account saves, gallery pages, community/social data, collaboration data, and
  remote media; and
- editor state or other Pixil/Pixilart features not represented by the exact
  fixture-backed fields above.

Unsupported features are rejected clearly when detected. Because Pixilart's
broader saved-project schema and editor feature set are not covered by this
contract, conversion is not guaranteed lossless.
