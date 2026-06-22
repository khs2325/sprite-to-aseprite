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

The first PNG frame is a coral four-pixel spark around a yellow center. The
second is the same shape shifted one pixel right and colored cyan. All unused
pixels are transparent. The flat PNG fixtures rebuild a timeline from frames;
they do not contain recoverable layer data.

The Piskel fixtures use only synthetic red, green, blue, yellow, white, and
transparent pixels. `multi-layer.piskel` uses source opacities `0.5` and `1`.
Artwork remains browser-local during conversion. Layers can be preserved only
when the `.piskel` source contains layer data.
