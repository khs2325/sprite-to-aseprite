import { describe, expect, it, vi } from "vitest";

import {
  createSpritesheetJsonProject,
  importSpritesheetJson,
  parseSpritesheetJsonMetadata,
} from ".";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function createSpritesheet(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data[pixel * 4] = pixel + 1;
    data[pixel * 4 + 3] = 255;
  }

  return { colorSpace: "srgb", data, height, width };
}

describe("parseSpritesheetJsonMetadata", () => {
  it("preserves array order and provided durations", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [
        { frame: { x: 2, y: 0, w: 2, h: 1 }, duration: 80 },
        { frame: { x: 0, y: 0, w: 2, h: 1 }, duration: 140 },
      ],
    }));

    expect(metadata.frames).toEqual([
      { frame: { x: 2, y: 0, w: 2, h: 1 }, duration: 80 },
      { frame: { x: 0, y: 0, w: 2, h: 1 }, duration: 140 },
    ]);
  });

  it("preserves object-map order and applies the default duration", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: {
        "walk-2": { frame: { x: 1, y: 0, w: 1, h: 1 } },
        "walk-1": { frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 75 },
      },
    }), { defaultFrameDurationMs: 120 });

    expect(metadata.frames.map(({ frame, duration }) => [frame.x, duration]))
      .toEqual([[1, 120], [0, 75]]);
  });

  it.each([
    [{ frame: { x: -1, y: 0, w: 1, h: 1 } }, "frame.x"],
    [{ frame: { x: 0, y: -1, w: 1, h: 1 } }, "frame.y"],
    [{ frame: { x: 0.5, y: 0, w: 1, h: 1 } }, "frame.x"],
    [{ frame: { x: 0, y: 0, w: 0, h: 1 } }, "frame.w"],
    [{ frame: { x: 0, y: 0, w: 1, h: 0 } }, "frame.h"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 0 }, "duration"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 1.5 }, "duration"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, rotated: true }, "rotated"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, trimmed: true }, "trimmed"],
  ])("rejects malformed frame metadata %#", (frame, field) => {
    expect(() => parseSpritesheetJsonMetadata(JSON.stringify({ frames: [frame] })))
      .toThrow(field);
  });

  it("rejects invalid JSON and empty frame collections", () => {
    expect(() => parseSpritesheetJsonMetadata("not json"))
      .toThrow("Spritesheet metadata is not valid JSON.");
    expect(() => parseSpritesheetJsonMetadata('{"frames":[]}'))
      .toThrow("Spritesheet metadata must contain at least one frame.");
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid default frame duration %s",
    (defaultFrameDurationMs) => {
      expect(() =>
        parseSpritesheetJsonMetadata('{"frames":[]}', {
          defaultFrameDurationMs,
        }),
      ).toThrow(
        "Default frame duration must be a positive integer in milliseconds.",
      );
    },
  );
});

describe("createSpritesheetJsonProject", () => {
  it("maps metadata order, durations, and frame pixels into one layer", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [
        { frame: { x: 2, y: 0, w: 2, h: 2 }, duration: 80 },
        { frame: { x: 0, y: 0, w: 2, h: 2 }, duration: 140 },
      ],
    }));

    const project = createSpritesheetJsonProject(
      createSpritesheet(4, 2),
      metadata,
    );

    expect(project).toMatchObject({
      width: 2,
      height: 2,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 80 },
        { index: 1, durationMs: 140 },
      ],
      layers: [{
        id: "main",
        name: "Main",
        visible: true,
        opacity: 255,
        cels: [
          { frameIndex: 0, x: 0, y: 0 },
          { frameIndex: 1, x: 0, y: 0 },
        ],
      }],
    });
    expect(project.layers[0].cels.map((cel) =>
      Array.from(cel.imageData.data).filter((_, index) => index % 4 === 0),
    )).toEqual([[3, 4, 7, 8], [1, 2, 5, 6]]);
  });

  it("rejects out-of-bounds and inconsistent frame rectangles", () => {
    expect(() => createSpritesheetJsonProject(createSpritesheet(2, 2), {
      frames: [{ frame: { x: 1, y: 0, w: 2, h: 2 }, duration: 100 }],
    })).toThrow("is outside spritesheet dimensions 2x2");

    expect(() => createSpritesheetJsonProject(createSpritesheet(3, 2), {
      frames: [
        { frame: { x: 0, y: 0, w: 2, h: 2 }, duration: 100 },
        { frame: { x: 2, y: 0, w: 1, h: 2 }, duration: 100 },
      ],
    })).toThrow("Frame 2 dimensions 1x2 do not match");
  });

  it("rejects rectangles beyond the bottom spritesheet bound", () => {
    expect(() =>
      createSpritesheetJsonProject(createSpritesheet(2, 2), {
        frames: [{ frame: { x: 0, y: 1, w: 2, h: 2 }, duration: 100 }],
      }),
    ).toThrow(
      "Frame 1 rectangle (0, 1, 2, 2) is outside spritesheet dimensions 2x2.",
    );
  });

  it("accepts rectangles exactly on the right and bottom bounds", () => {
    const project = createSpritesheetJsonProject(createSpritesheet(3, 3), {
      frames: [{ frame: { x: 1, y: 1, w: 2, h: 2 }, duration: 60 }],
    });

    expect(project.frames).toEqual([{ index: 0, durationMs: 60 }]);
    expect(
      Array.from(project.layers[0].cels[0].imageData.data).filter(
        (_, index) => index % 4 === 0,
      ),
    ).toEqual([5, 6, 8, 9]);
  });

  it("rejects invalid spritesheet dimensions", () => {
    expect(() =>
      createSpritesheetJsonProject(createSpritesheet(2, 0), {
        frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 100 }],
      }),
    ).toThrow("Spritesheet contains invalid RGBA image data.");
  });
});

describe("importSpritesheetJson", () => {
  it("reads browser-local metadata and decodes the PNG", async () => {
    const spritesheetFile = Object.assign(
      new Blob([PNG_SIGNATURE], { type: "image/png" }),
      { lastModified: 0, name: "sheet.png" },
    ) as File;
    const metadataFile = Object.assign(new Blob([JSON.stringify({
      frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 90 }],
    })], { type: "application/json" }), {
      lastModified: 0,
      name: "sheet.json",
    }) as File;
    const spritesheet = createSpritesheet(1, 1);
    const decodePng = vi.fn<(file: File) => Promise<ImageData>>()
      .mockResolvedValue(spritesheet);

    const project = await importSpritesheetJson(
      spritesheetFile,
      metadataFile,
      {},
      { decodePng },
    );

    expect(decodePng).toHaveBeenCalledWith(spritesheetFile);
    expect(project.frames).toEqual([{ index: 0, durationMs: 90 }]);
    expect(project.layers[0].cels[0].imageData.data[0]).toBe(1);
  });
});
