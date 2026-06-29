# PSD Fixture Strategy

Status: documentation-only. Do not commit PSD binary fixtures yet.

PSD importer fixtures must be tiny, synthetic, and reproducible. They must not
use downloaded art, copyrighted samples, private user files, or converted
project artwork. The fixture set should exist only to prove parser behavior for
the PSD MVP described in [psd-format.md](psd-format.md).

## Source Policy

- Generate every PSD fixture from explicit numeric pixel data and metadata kept
  in the repository.
- Keep generation local and deterministic. The generator must not perform
  network calls, embed timestamps, read user artwork, or depend on local editor
  state.
- Prefer canvases from 1 by 1 through 4 by 4 pixels unless a larger canvas is
  needed to prove offsets or bounds validation.
- Use obvious synthetic colors such as transparent, coral, cyan, yellow, black,
  and white. Do not use photos, logos, sprites from games, sample PSDs from the
  web, or user-provided files.
- Future committed `.psd` files should be produced by a checked-in generator and
  verified byte-for-byte by `node tests/fixtures/generate.mjs --check` or an
  equivalent fixture check command.

## Planned Positive Fixtures

These cases cover the supported RGB 8-bit raster-layer subset before importer
work starts.

| Fixture | Canvas | Layers | Metadata covered |
| --- | --- | ---: | --- |
| `psd/rgb8-two-raster-layers.psd` | 4 by 3 | 2 | PSD version 1, RGB color mode, 8-bit depth, normal blend mode, root-layer order, Unicode names, visible layers, opacity `255` and `128`, offsets `(0,1)` and `(1,-1)`, RGBA channel decoding |
| `psd/rgb8-hidden-layer.psd` | 3 by 3 | 2 | hidden flag mapping to `visible: false`, visible sibling layer, opacity `64`, signed offset `(-1,0)`, deterministic generated layer IDs |
| `psd/rgb8-no-alpha-channel.psd` | 2 by 2 | 1 | RGB layer with no transparency channel, synthesized alpha `255`, one frame at 100 ms |
| `psd/rgb8-unicode-name.psd` | 2 by 1 | 1 | Unicode layer name preference over Pascal name fallback, safe deterministic fallback when a name is blank |

Pixel patterns should be small enough for tests to assert complete RGBA arrays.
Layer opacity must remain layer metadata; generated pixels must not be
premultiplied or composited. Offsets must remain `SpriteCel.x` and
`SpriteCel.y`; generated pixel data must not be padded to the full canvas.

## Planned Unsupported Fixtures

Unsupported fixtures should reject with focused diagnostics and must not produce
a partial `SpriteProject`.

| Fixture | Unsupported condition |
| --- | --- |
| `psd/unsupported-cmyk.psd` | color mode is not RGB |
| `psd/unsupported-depth-16.psd` | channel depth is not 8 bits |
| `psd/unsupported-text-layer.psd` | text layer metadata is present |
| `psd/unsupported-group.psd` | group or section-divider layer is present |
| `psd/unsupported-blend-mode.psd` | layer blend mode is not normal |
| `psd/unsupported-mask.psd` | layer mask or vector mask metadata is present |
| `psd/invalid-channel-length.psd` | decoded channel byte count does not match the layer rectangle |
| `psd/invalid-layer-rectangle.psd` | layer rectangle has zero, negative, or unsafe dimensions |

Unsupported fixtures may include valid synthetic pixels, but the unsupported
feature being tested should be the first reason for rejection.

## Reproducibility Requirements

When generator work is scoped, add deterministic fixture source data before
committing generated PSDs:

- Store fixture definitions as plain data: canvas size, PSD header fields,
  layer records, channel IDs, rectangles, opacity bytes, visibility flags, names,
  and RGBA pixel matrices.
- Use stable layer order and stable generated IDs. Tests should not depend on
  filesystem enumeration order.
- Write binary sections with fixed byte order and explicit lengths. Avoid any
  library API that silently writes creation time, editor metadata, thumbnails,
  previews, color profiles, or machine-specific IDs.
- Add a check mode that regenerates each PSD into memory and compares exact
  bytes with the committed fixture.
- Keep fixture metadata beside the generator so tests can assert expected
  `SpriteProject` values without decoding expectations from the binary file
  itself.

## Metadata Assertions Before Importer Work

Before the PSD importer exists, fixture tests should assert structural metadata
only. They should verify:

- The fixture file exists only after the generator task is intentionally added;
  no ad hoc PSD files are accepted.
- The PSD signature is `8BPS`, version is `1`, color mode is RGB, and channel
  depth is 8 for positive fixtures.
- Canvas width and height match the fixture table.
- Layer count, layer names, layer rectangles, opacity bytes, visibility flags,
  blend modes, and channel IDs match the fixture metadata.
- Unsupported fixtures contain the intended unsupported feature and otherwise
  remain small synthetic files.
- No fixture contains thumbnail, preview, merged-image-only, external asset, or
  user/path metadata that tests would accidentally treat as preserved artwork.

Importer tests added later should assert the resulting `SpriteProject`: one
frame, top-first layer order, layer names, visibility, opacity, cel offsets, cel
dimensions, complete RGBA pixels, and rejection diagnostics for unsupported
features.
