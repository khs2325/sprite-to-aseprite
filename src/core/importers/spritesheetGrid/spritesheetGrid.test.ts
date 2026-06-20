import { describe, expect, it, vi } from "vitest";

import {
  createSpritesheetGridProject,
  importSpritesheetGrid,
  type SpritesheetGridImportOptions,
} from ".";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const DEFAULT_OPTIONS: SpritesheetGridImportOptions = {
  frameWidth: 1,
  frameHeight: 1,
  rows: 2,
  columns: 3,
  frameOrder: "row-major",
};

function createSpritesheet(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * 4] = pixel + 1;
    data[pixel * 4 + 3] = 255;
  }

  return { colorSpace: "srgb", data, height, width };
}

function redValues(project: ReturnType<typeof createSpritesheetGridProject>): number[] {
  return project.layers[0].cels.map((cel) => cel.imageData.data[0]);
}

describe("createSpritesheetGridProject", () => {
  it("slices frames in row-major order into one layer", () => {
    const project = createSpritesheetGridProject(
      createSpritesheet(3, 2),
      { ...DEFAULT_OPTIONS, frameDurationMs: 125 },
    );

    expect(project).toMatchObject({
      width: 1,
      height: 1,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 125 },
        { index: 1, durationMs: 125 },
        { index: 2, durationMs: 125 },
        { index: 3, durationMs: 125 },
        { index: 4, durationMs: 125 },
        { index: 5, durationMs: 125 },
      ],
      layers: [
        {
          id: "main",
          name: "Main",
          visible: true,
          opacity: 255,
          cels: [
            { frameIndex: 0, x: 0, y: 0 },
            { frameIndex: 1, x: 0, y: 0 },
            { frameIndex: 2, x: 0, y: 0 },
            { frameIndex: 3, x: 0, y: 0 },
            { frameIndex: 4, x: 0, y: 0 },
            { frameIndex: 5, x: 0, y: 0 },
          ],
        },
      ],
    });
    expect(project.layers).toHaveLength(1);
    expect(redValues(project)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("slices frames in column-major order", () => {
    const project = createSpritesheetGridProject(createSpritesheet(3, 2), {
      ...DEFAULT_OPTIONS,
      frameOrder: "column-major",
    });

    expect(redValues(project)).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it("copies every pixel in multi-pixel frames", () => {
    const project = createSpritesheetGridProject(createSpritesheet(4, 2), {
      frameWidth: 2,
      frameHeight: 2,
      rows: 1,
      columns: 2,
      frameOrder: "row-major",
    });

    expect(
      Array.from(project.layers[0].cels[0].imageData.data).filter(
        (_, index) => index % 4 === 0,
      ),
    ).toEqual([1, 2, 5, 6]);
    expect(
      Array.from(project.layers[0].cels[1].imageData.data).filter(
        (_, index) => index % 4 === 0,
      ),
    ).toEqual([3, 4, 7, 8]);
  });

  it("rejects grids that exceed or leave unused source pixels", () => {
    expect(() =>
      createSpritesheetGridProject(createSpritesheet(3, 2), {
        ...DEFAULT_OPTIONS,
        columns: 4,
      }),
    ).toThrow("Grid dimensions 4x2 do not fit spritesheet dimensions 3x2.");

    expect(() =>
      createSpritesheetGridProject(createSpritesheet(4, 2), DEFAULT_OPTIONS),
    ).toThrow("Grid dimensions 3x2 do not fit spritesheet dimensions 4x2.");
  });

  it("rejects invalid grid options", () => {
    expect(() =>
      createSpritesheetGridProject(createSpritesheet(3, 2), {
        ...DEFAULT_OPTIONS,
        rows: 0,
      }),
    ).toThrow("Rows must be a positive integer.");
    expect(() =>
      createSpritesheetGridProject(createSpritesheet(3, 2), {
        ...DEFAULT_OPTIONS,
        frameOrder: "diagonal" as "row-major",
      }),
    ).toThrow('Frame order must be "row-major" or "column-major".');
  });
});

describe("importSpritesheetGrid", () => {
  it("decodes a browser-local PNG before slicing it", async () => {
    const file = Object.assign(new Blob([PNG_SIGNATURE], { type: "image/png" }), {
      lastModified: 0,
      name: "sheet.png",
    }) as File;
    const spritesheet = createSpritesheet(3, 2);
    const decodePng = vi.fn<(file: File) => Promise<ImageData>>()
      .mockResolvedValue(spritesheet);

    const project = await importSpritesheetGrid(
      file,
      DEFAULT_OPTIONS,
      { decodePng },
    );

    expect(decodePng).toHaveBeenCalledOnce();
    expect(decodePng).toHaveBeenCalledWith(file);
    expect(redValues(project)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
