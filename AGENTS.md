# AGENTS.md

## Project

This repository is `Sprite to Aseprite Converter`.

Goal:
Build a static browser-based app that converts sprite-related files into editable `.aseprite` files.

MVP:
1. PNG sequence -> `.aseprite`
2. Spritesheet grid -> `.aseprite`
3. Spritesheet PNG + JSON -> `.aseprite`

Later:
1. `.piskel` -> `.aseprite`
2. GIF/APNG -> `.aseprite`
3. Pixelorama `.pxo` -> `.aseprite`

## Hard rules

- Keep user file processing browser-only.
- Do not upload user artwork or sprite files to a server.
- Do not claim that layers can be recovered from a flat PNG.
- Use accurate wording:
  - "rebuild timeline"
  - "convert frames"
  - "preserve layers when the source format contains layer data"
- Do not push directly to `main`.
- Do not change unrelated files.
- Do not add production dependencies without explaining why.
- Do not remove tests just to make checks pass.
- Keep diffs small.

## Architecture

All importers must convert input files into `SpriteProject`.

All exporters must consume `SpriteProject`.

Core file processing logic must stay independent from UI code.

Canonical internal model:

```ts
type SpriteProject = {
  width: number;
  height: number;
  colorMode: "rgba";
  frames: SpriteFrame[];
  layers: SpriteLayer[];
};

type SpriteFrame = {
  index: number;
  durationMs: number;
};

type SpriteLayer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  cels: SpriteCel[];
};

type SpriteCel = {
  frameIndex: number;
  x: number;
  y: number;
  imageData: ImageData;
};
```

## Verification commands

Before completing any implementation task, run:

```bash
npm run typecheck
npm run test
npm run build
```

If a command does not exist yet, add the missing script or explain why it cannot be run.

## Review policy

Treat these as high-priority issues:

- User files are uploaded to a server.
- A flat PNG is described as having recoverable layers.
- A binary writer change has no tests.
- A parser accepts invalid data silently.
- UI claims conversion is lossless without proof.
- Build, typecheck, or tests fail.
- `package.json`, lockfiles, or workflow files changed unexpectedly.

## Definition of done

A task is complete only when:

1. The requested scope is implemented.
2. Tests are added or updated when logic changes.
3. TypeScript passes.
4. Tests pass.
5. Build passes.
6. The final summary lists changed files and verification results.
