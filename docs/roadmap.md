# Roadmap

## Phase 0 — Automation framework

- Add AGENTS.md
- Add task YAML format
- Add prompt generator
- Add Codex runner
- Add auto-dev cycle
- Add basic CI

## Phase 1 — Core model

- Implement `SpriteProject`
- Add validation
- Add tiny test assets
- Add test helpers

## Phase 2 — Simple importers

- PNG sequence -> SpriteProject
- Spritesheet grid -> SpriteProject
- Spritesheet JSON -> SpriteProject

## Phase 3 — Aseprite writer

- Minimal `.aseprite` binary writer
- RGBA 32-bit
- Normal layer/cel/frame support
- Frame duration support
- Tests with known tiny fixtures

## Phase 4 — UI

- Drag and drop
- File preview
- Export button
- Error messages
- Browser-only privacy notice

## Phase 5 — Site pages

- `/tools/png-sequence-to-aseprite`
- `/tools/spritesheet-to-aseprite`
- `/guides/how-to-convert-spritesheet-to-aseprite`
- `/privacy`
- `/about`

## Phase 6 — More formats

- Piskel:
  1. [x] synthetic fixtures and supported-format notes
  2. [x] core `.piskel` parser/importer to `SpriteProject`
  3. [x] `.piskel` to `.aseprite` integration coverage
  4. [x] browser UI import-mode wiring
  5. [x] user documentation and Aseprite verification guidance
- Atlas compatibility:
  1. [ ] TexturePacker trimmed frames (task 039)
  2. [ ] TexturePacker rotated frames (task 040)
  3. [ ] atlas format detection and compatibility diagnostics (task 041)
- Frame tags:
  1. [ ] SpriteProject model and Aseprite JSON mapping (task 042)
  2. [ ] `.aseprite` frame-tag export (task 043)
- GIF:
  1. [x] supported-subset research and deterministic fixtures (task 044)
  2. [ ] core animated GIF importer (task 045)
- APNG:
  1. [x] supported-subset research and deterministic fixtures (task 046)
  2. [ ] core APNG importer (task 047)
- Additional free/open art tool project formats:
  1. [x] OpenRaster `.ora` research and deterministic fixtures (task 048)
  2. [ ] OpenRaster `.ora` importer (task 049)
  3. [ ] OpenRaster `.ora` browser UI wiring (task 050)
  4. [x] Pixelorama `.pxo` research and deterministic fixtures (task 051)
  5. [ ] Pixelorama `.pxo` importer (task 052)
  6. [ ] Pixelorama `.pxo` browser UI wiring (task 053)
  7. [x] Krita `.kra` minimal raster subset research and fixtures (task 054)
  8. [ ] Krita `.kra` importer (task 055)
  9. [ ] Krita `.kra` browser UI wiring (task 056)
  10. [x] GIMP `.xcf` feasibility research only (task 057)
  11. [ ] LibreSprite/Aseprite `.ase`/`.aseprite` input feasibility research only (task 058)

The project-format sequence starts with researched, fixture-backed subsets
before importer work, then wires each completed importer into the browser UI.
All planned processing remains local to the browser. The converter should
preserve only documented supported raster layer/frame data and must not claim
that flat or unsupported source features can be recovered.
