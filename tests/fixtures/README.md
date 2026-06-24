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

The first PNG frame is a coral four-pixel spark around a yellow center. The
second is the same shape shifted one pixel right and colored cyan. All unused
pixels are transparent. The flat PNG fixtures rebuild a timeline from frames;
they do not contain recoverable layer data.

The Piskel fixtures use only synthetic red, green, blue, yellow, white, and
transparent pixels. `multi-layer.piskel` uses source opacities `0.5` and `1`.
Artwork remains browser-local during conversion. Layers can be preserved only
when the `.piskel` source contains layer data.

GIF fixtures are flat animations and contain no recoverable source layers.
