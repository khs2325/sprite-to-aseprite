# Synthetic sprite fixtures

These tiny files are original, programmatically generated test artwork. They
contain no user artwork or third-party assets. Run `node generate.mjs` from this
directory to reproduce the files byte-for-byte. Run `node generate.mjs --check`
to verify them without writing.

## Expected geometry

| Fixture | Canvas | Frames | Frame rectangles | Timing |
| --- | --- | ---: | --- | --- |
| `png-sequence/spark-01.png`, `spark-02.png` | 4×4 each | 2 | one 4×4 frame per file | importer setting |
| `spritesheet/spark-sheet.png` | 8×4 | 2 | `(0,0,4,4)`, `(4,0,4,4)` | grid importer setting |
| `spritesheet/spark-sheet.json` | 8×4 sheet | 2 | `(0,0,4,4)`, `(4,0,4,4)` | 80 ms, 120 ms |

The Piskel fixtures add these cases:

| Fixture | Canvas | Frames | Layers and chunks | Timing |
| --- | --- | ---: | --- | --- |
| `piskel/multi-frame.piskel` | 2 by 2 | 3 | `Motion`, split across two PNG chunks | 12 FPS -> 83 ms |
| `piskel/multi-layer.piskel` | 2 by 2 | 2 | `Background`, then `Accent`; one chunk each | 20 FPS -> 50 ms |

The GIF fixtures add these structural cases. They are GIF89a files with a
four-entry synthetic palette; tests inspect their block metadata without using
a production GIF decoder.

| Fixture | Canvas | Frames and rectangles | Raw delay -> normalized timing | Disposal |
| --- | --- | --- | --- | --- |
| `gif/timing-transparency-offsets.gif` | 3 by 2 | full canvas, `(1,0,2,1)`, `(2,1,1,1)`, `(0,1,1,1)` | 0 -> 100 ms, 1 -> 20 ms, 12 -> 120 ms, 65535 -> 65535 ms | keep |
| `gif/disposal-background.gif` | 3 by 2 | full canvas, `(1,0,1,1)`, `(2,0,1,1)` | 5 -> 50 ms each | keep, background, keep |
| `gif/disposal-previous.gif` | 3 by 2 | full canvas, `(1,0,1,2)`, `(2,1,1,1)` | 7 -> 70 ms each | keep, previous, keep |
| `gif/invalid-frame-bounds.gif` | 3 by 2 | full canvas, then `(2,1,2,1)` outside the canvas | 5 -> 50 ms each | keep |

The timing fixture declares an infinite `NETSCAPE2.0` loop and uses transparent
palette index 0. The background-disposal fixture requires the second frame's
rectangle to be cleared before the third is drawn. The previous-disposal
fixture requires the pre-second-frame canvas to be restored before the third
is drawn. The invalid fixture is intentionally structurally out of bounds for
task 045 rejection tests.

The APNG fixtures add these RGBA8, non-interlaced cases. Tests validate their
chunk CRCs and sequence numbers, inflate their filter-0 rows, and compare the
composited full-canvas snapshots.

| Fixture | Canvas | Frames and rectangles | Timing | Blend/disposal |
| --- | --- | --- | --- | --- |
| `apng/timing-offsets.apng` | 3 by 2 | full canvas, `(1,0,2,1)`, `(2,1,1,1)`, `(0,1,1,1)` | `0/100` -> 1 ms, `1/60` -> 17 ms, `1/0` -> 10 ms, `65535/1` -> 65535 ms | source, none |
| `apng/blend.apng` | 2 by 1 | full canvas, `(0,0,1,1)`, `(1,0,1,1)` | 100 ms each | source replacement, then over alpha blend |
| `apng/disposal.apng` | 3 by 1 | full canvas, `(1,0,1,1)`, `(2,0,1,1)`, `(0,0,1,1)` | 50 ms each | none, background, previous, none |

`blend.apng` replaces opaque red with 50%-alpha blue using source, then
composites 50%-alpha red over opaque green to produce `[128,127,0,255]`.
`disposal.apng` proves that background clears only its frame rectangle and
previous restores the pre-draw rectangle before the following frame. APNG
fixtures are flat animations and contain no recoverable source layers.

The OpenRaster fixtures add deterministic ZIP-backed `.ora` containers for the
future single-frame layered raster importer. Tests inspect their ZIP signatures,
stored `mimetype`, `stack.xml` metadata, referenced PNG signatures, and preview
PNG dimensions without implementing conversion.

| Fixture | Canvas | Layers | Metadata covered |
| --- | --- | ---: | --- |
| `openraster/two-layers.ora` | 4 by 3 | 2 | source order, names, visible/hidden, opacity `0.5` and default `1`, offsets `(1,-1)` and `(0,1)`, normal blend |
| `openraster/unsupported-blend-mode.ora` | 4 by 3 | 2 | same as above, but top layer uses unsupported `svg:multiply` |
| `openraster/missing-layer-data.ora` | 4 by 3 | 2 references | `stack.xml` references `data/top-hidden.png`, which is intentionally absent |
| `openraster/malformed-stack.ora` | 4 by 3 | malformed | valid ZIP and PNG data with malformed `stack.xml` |

OpenRaster fixtures contain synthetic coral, cyan, yellow, and transparent
pixels only. They are intended to preserve layers when the source format
contains supported layer data; they do not use `mergedimage.png` to recover
layers.

The Pixelorama fixtures add deterministic ZIP-backed `.pxo` containers for the
future importer. Tests inspect `data.json`, `mimetype`, preview PNG metadata,
and raw RGBA cel payloads without implementing conversion.

| Fixture | Canvas | Frames | Layers | Metadata covered |
| --- | --- | ---: | ---: | --- |
| `pixelorama/two-layers-two-frames.pxo` | 2 by 2 | 2 | 2 | `pxo_version` 6, RGBA8 color mode, layer order, names, visibility, opacity, frame duration multipliers, raw `image_data/frames/{frame}/layer_{layer}` payloads |
| `pixelorama/unsupported-blend-mode.pxo` | 2 by 2 | 1 | 1 | non-normal `blend_mode` for rejection |
| `pixelorama/unsupported-effects.pxo` | 2 by 2 | 1 | 1 | non-empty layer `effects` for rejection |
| `pixelorama/unsupported-tilemap-layer.pxo` | 2 by 2 | 1 | 1 tilemap | layer `type` 3 and `tilesets/` data for rejection |
| `pixelorama/missing-image-data.pxo` | 2 by 2 | 1 | 1 | missing required raw cel image payload |
| `pixelorama/ambiguous-metadata.pxo` | 2 by 2 | 1 | 1 | non-empty project metadata for rejection |

Pixelorama fixtures contain only synthetic coral, cyan, yellow, and transparent
pixels. They are intended to preserve layers when a supported `.pxo` source
contains pixel layer data; they do not cover tilemaps, effects, groups, 3D
layers, audio layers, indexed color, or ambiguous metadata.

The Pixil fixtures add deterministic JSON `.pixil` containers for the
fixture-gated importer subset. They use root `pixil.format`
`pixilart.com/pixil-project`, `schemaVersion` 1, explicit frame and layer
indexes, per-frame millisecond durations, normal blend mode, layer visibility,
opacity in the `0..1` range, and full-canvas raw RGBA cels encoded as strict
base64. They are generated locally from synthetic pixels and do not use
Pixilart gallery, account, downloaded, private, or user-provided artwork.

| Fixture | Canvas | Frames | Layers | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `pixil/two-layers-two-frames.pixil` | 2 by 2 | 2 | 2 | `529eee6fdde65c9390c966b204bc463ce81ae49f02e9e4d6263e9350e3641c33` |
| `pixil/unsupported-blend-mode.pixil` | 2 by 2 | 2 | 2 | `19b8511a877fbddf7c15c6d8e7eb73707d1fbeab5fd7aaf5e5a8cc9ac3414e03` |
| `pixil/external-image-url.pixil` | 2 by 2 | 2 | 2 | `e62f8456efb54aa87992acfe6cdfca44b563d45428dc0927d0b2a0f547193600` |
| `pixil/missing-cel.pixil` | 2 by 2 | 2 | 2 | `66405e7ff2932599a1ffb92af84d81b60229c8af3b1285d3516931532cb0491c` |
| `pixil/ambiguous-layer-index.pixil` | 2 by 2 | 2 | 2 | `14d5c2b99cc001e28b03ad478a3b985774abd1d285b7148ba6e9edbda44547fb` |

Pixil fixtures preserve layers only when the `.pixil` source contains this
supported layer data. They do not cover alternate Pixilart containers,
compressed or encrypted variants, external image URLs, previews, flattened
exports, non-normal blend modes, clipping, alpha lock, partial-canvas cels,
groups, palettes, social metadata, or ambiguous ordering.

The Krita fixtures add deterministic ZIP-backed `.kra` containers for the
future minimal native-raster importer. Tests inspect the stored `mimetype`,
`maindoc.xml`, preview PNGs, native paint-device tile headers, default pixels,
and BGRA tile bytes without implementing conversion.

| Fixture | Canvas | Layers | Metadata covered |
| --- | --- | ---: | --- |
| `krita/two-paint-layers.kra` | 2 by 2 | 2 | `application/x-krita` ZIP mimetype, `IMAGE mime="application/x-kra"`, syntax version `2.0`, 8-bit `RGBA` color space, source order, names, visible/hidden, opacity `128` and `255`, offsets `(1,-1)` and `(0,0)`, normal composite op, native tile payloads |
| `krita/unsupported-vector-layer.kra` | 2 by 2 | 1 vector | `nodetype="shapelayer"` for rejection |
| `krita/unsupported-color-depth.kra` | 2 by 2 | 1 | image and layer `colorspacename="RGBA16"` for rejection |
| `krita/missing-layer-data.kra` | 2 by 2 | 2 references | `maindoc.xml` references `layer1` and `layer2`, whose native payload entries are intentionally absent |
| `krita/flattened-preview-only.kra` | 2 by 2 | 0 | valid preview and `mergedimage.png`, but no layer data to preserve |

Krita paint-layer bytes are not PNGs in normal `.kra` saves. The positive
fixture uses Krita tile format version 2 with one raw 64 by 64 tile per layer:
`VERSION 2`, `TILEWIDTH 64`, `TILEHEIGHT 64`, `PIXELSIZE 4`, `DATA 1`, then a
tile header such as `0,0,LZF,16385`. The first byte of that tile payload is
`0`, meaning raw tile data, followed by 64 by 64 pixels. Krita's `RGBA` color
space stores unmanaged 8-bit pixels in native BGRA byte order, so importer
tests must convert those bytes to browser `ImageData` RGBA. `preview.png` and
`mergedimage.png` are flattened previews and must not be used to recover
layers.

Planned PSD fixtures are documented in `docs/psd-fixtures.md`. Do not add PSD
binary fixtures yet. Future `.psd` fixtures must be synthetic, generated
locally, reproducible byte-for-byte, and free of downloaded, copyrighted,
private, or user-provided artwork.

The first PNG frame is a coral four-pixel spark around a yellow center. The
second is the same shape shifted one pixel right and colored cyan. All unused
pixels are transparent. The flat PNG fixtures rebuild a timeline from frames;
they do not contain recoverable layer data.

The Piskel fixtures use only synthetic red, green, blue, yellow, white, and
transparent pixels. `multi-layer.piskel` uses source opacities `0.5` and `1`.
Artwork remains browser-local during conversion. Layers can be preserved only
when the `.piskel` source contains layer data.

GIF fixtures are flat animations and contain no recoverable source layers.
