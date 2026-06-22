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
  1. synthetic fixtures and supported-format notes
  2. core `.piskel` parser/importer to `SpriteProject`
  3. `.piskel` to `.aseprite` integration coverage
  4. browser UI import-mode wiring
  5. user documentation and Aseprite verification guidance
- GIF/APNG
- Pixelorama `.pxo`
