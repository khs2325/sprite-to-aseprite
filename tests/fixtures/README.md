# Synthetic sprite fixtures

These tiny files are original, programmatically generated test artwork. They
contain no user artwork or third-party assets. Run `node generate.mjs` from this
directory to reproduce the PNG files byte-for-byte.

## Expected geometry

| Fixture | Canvas | Frames | Frame rectangles | Timing |
| --- | --- | ---: | --- | --- |
| `png-sequence/spark-01.png`, `spark-02.png` | 4×4 each | 2 | one 4×4 frame per file | importer setting |
| `spritesheet/spark-sheet.png` | 8×4 | 2 | `(0,0,4,4)`, `(4,0,4,4)` | grid importer setting |
| `spritesheet/spark-sheet.json` | 8×4 sheet | 2 | `(0,0,4,4)`, `(4,0,4,4)` | 80 ms, 120 ms |

The first frame is a coral four-pixel spark around a yellow center. The second
is the same shape shifted one pixel right and colored cyan. All unused pixels
are transparent. The flat PNG fixtures rebuild a timeline from frames; they do
not contain recoverable layer data.
