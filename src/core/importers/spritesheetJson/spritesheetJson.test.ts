import { describe, expect, it, vi } from "vitest";

import {
  createSpritesheetJsonProject,
  detectAtlasJsonFormat,
  getSpritesheetJsonImportDiagnostic,
  importSpritesheetJson,
  parseSpritesheetJsonMetadata,
  SpritesheetJsonImportError,
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

describe("detectAtlasJsonFormat", () => {
  it.each([
    [
      { frames: [], meta: { app: "https://www.aseprite.org/" } },
      { family: "aseprite", variant: "array" },
    ],
    [
      { frames: [], meta: { app: "TexturePacker" } },
      { family: "texturepacker", variant: "array" },
    ],
    [
      { frames: {}, meta: { app: "TexturePacker" } },
      { family: "texturepacker", variant: "hash" },
    ],
    [
      { animations: {}, frames: {} },
      { family: "phaser-pixi", variant: "hash" },
    ],
    [
      { textures: [{ frames: [] }] },
      { family: "phaser-pixi", variant: "multiatlas" },
    ],
    [
      { assets: [] },
      { family: "unknown", variant: "unknown" },
    ],
  ] as const)("detects structural atlas signal %#", (value, detection) => {
    expect(detectAtlasJsonFormat(value)).toEqual(detection);
  });
});

describe("parseSpritesheetJsonMetadata", () => {
  it("keeps supported Aseprite and Pixi-compatible root frames unchanged", () => {
    const aseprite = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{ frame: { x: 0, y: 0, w: 2, h: 2 }, duration: 80 }],
      meta: { app: "https://www.aseprite.org/" },
    }));
    const pixi = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: {
        idle: { frame: { x: 2, y: 0, w: 2, h: 2 }, duration: 90 },
      },
      animations: { idle: ["idle"] },
    }));

    expect(aseprite.frames).toEqual([
      { frame: { x: 0, y: 0, w: 2, h: 2 }, duration: 80 },
    ]);
    expect(pixi.frames).toEqual([
      { frame: { x: 2, y: 0, w: 2, h: 2 }, duration: 90 },
    ]);
    expect(aseprite.frameTags).toBeUndefined();
    expect(pixi.frameTags).toBeUndefined();
  });

  it("maps ordered Aseprite frame tags into supported model directions", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [
        { frame: { x: 0, y: 0, w: 1, h: 1 } },
        { frame: { x: 1, y: 0, w: 1, h: 1 } },
        { frame: { x: 2, y: 0, w: 1, h: 1 } },
      ],
      meta: {
        app: "https://www.aseprite.org/",
        frameTags: [
          { name: "Walk", from: 0, to: 2, direction: "forward" },
          { name: "Back", from: 1, to: 2, direction: "reverse" },
          { name: "Idle", from: 0, to: 1, direction: "pingpong" },
        ],
      },
    }));

    expect(metadata.frameTags).toEqual([
      { name: "Walk", from: 0, to: 2, direction: "forward" },
      { name: "Back", from: 1, to: 2, direction: "reverse" },
      { name: "Idle", from: 0, to: 1, direction: "ping-pong" },
    ]);
  });

  it.each([
    ["not an array", "meta.frameTags must be an array"],
    [[null], "meta.frameTags[0] must be an object"],
    [[{ name: "", from: 0, to: 0, direction: "forward" }], "frameTags[0].name"],
    [[{ name: "Bad", from: -1, to: 0, direction: "forward" }], "frameTags[0].from"],
    [[{ name: "Bad", from: 0, to: 0.5, direction: "forward" }], "frameTags[0].to"],
    [[{ name: "Bad", from: 1, to: 0, direction: "forward" }], "less than or equal"],
    [[{ name: "Bad", from: 0, to: 2, direction: "forward" }], "existing frame index"],
    [[{ name: "Bad", from: 0, to: 0, direction: "ping-pong" }], "direction"],
    [[
      { name: "Same", from: 0, to: 0, direction: "forward" },
      { name: "Same", from: 0, to: 0, direction: "reverse" },
    ], "duplicates an earlier frame tag name"],
  ])("rejects malformed Aseprite frame tags %#", (frameTags, error) => {
    expect(() => parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 } }],
      meta: { app: "Aseprite", frameTags },
    }))).toThrow(error);
  });

  it("does not interpret non-Aseprite atlas metadata as frame tags", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{ frame: { x: 0, y: 0, w: 1, h: 1 } }],
      meta: {
        app: "TexturePacker",
        frameTags: [{ name: "Atlas data", from: 0, to: 0, direction: "forward" }],
      },
    }));

    expect(metadata.frameTags).toBeUndefined();
  });

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

  it("parses complete TexturePacker trim geometry", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{
        frame: { x: 1, y: 2, w: 2, h: 1 },
        duration: 85,
        trimmed: true,
        sourceSize: { w: 4, h: 3 },
        spriteSourceSize: { x: 1, y: 1, w: 2, h: 1 },
      }],
    }));

    expect(metadata.frames).toEqual([{
      frame: { x: 1, y: 2, w: 2, h: 1 },
      duration: 85,
      trimmed: true,
      sourceSize: { w: 4, h: 3 },
      spriteSourceSize: { x: 1, y: 1, w: 2, h: 1 },
    }]);
  });

  it("parses TexturePacker rotated frames and swapped trim dimensions", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [
        {
          frame: { x: 0, y: 0, w: 2, h: 3 },
          duration: 70,
          rotated: true,
        },
        {
          frame: { x: 2, y: 0, w: 1, h: 2 },
          duration: 90,
          rotated: true,
          trimmed: true,
          sourceSize: { w: 4, h: 3 },
          spriteSourceSize: { x: 1, y: 1, w: 2, h: 1 },
        },
      ],
    }));

    expect(metadata.frames).toEqual([
      {
        frame: { x: 0, y: 0, w: 2, h: 3 },
        duration: 70,
        rotated: true,
      },
      {
        frame: { x: 2, y: 0, w: 1, h: 2 },
        duration: 90,
        rotated: true,
        trimmed: true,
        sourceSize: { w: 4, h: 3 },
        spriteSourceSize: { x: 1, y: 1, w: 2, h: 1 },
      },
    ]);
  });

  it.each([
    [{ frame: { x: -1, y: 0, w: 1, h: 1 } }, "frame.x"],
    [{ frame: { x: 0, y: -1, w: 1, h: 1 } }, "frame.y"],
    [{ frame: { x: 0.5, y: 0, w: 1, h: 1 } }, "frame.x"],
    [{ frame: { x: 0, y: 0, w: 0, h: 1 } }, "frame.w"],
    [{ frame: { x: 0, y: 0, w: 1, h: 0 } }, "frame.h"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 0 }, "duration"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, duration: 1.5 }, "duration"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, rotated: 90 }, "rotated"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, rotated: "clockwise" }, "rotated"],
    [{ frame: { x: 0, y: 0, w: 1, h: 1 }, trimmed: "true" }, "trimmed"],
  ])("rejects malformed frame metadata %#", (frame, field) => {
    expect(() => parseSpritesheetJsonMetadata(JSON.stringify({ frames: [frame] })))
      .toThrow(field);
  });

  it.each([
    [{}, "sourceSize must be an object"],
    [{ sourceSize: { w: 0, h: 2 } }, "sourceSize.w"],
    [{ sourceSize: { w: 2 } }, "sourceSize.h"],
    [{ sourceSize: { w: 2, h: 2 } }, "spriteSourceSize must be an object"],
    [{
      sourceSize: { w: 2, h: 2 },
      spriteSourceSize: { x: -1, y: 0, w: 1, h: 1 },
    }, "spriteSourceSize.x"],
    [{
      sourceSize: { w: 2, h: 2 },
      spriteSourceSize: { x: 0, y: -1, w: 1, h: 1 },
    }, "spriteSourceSize.y"],
    [{
      sourceSize: { w: 2, h: 2 },
      spriteSourceSize: { x: 0, y: 0, w: 0, h: 1 },
    }, "spriteSourceSize.w"],
    [{
      sourceSize: { w: 2, h: 2 },
      spriteSourceSize: { x: 0, y: 0, w: 1, h: 0 },
    }, "spriteSourceSize.h"],
    [{
      sourceSize: { w: 3, h: 2 },
      spriteSourceSize: { x: 0, y: 0, w: 2, h: 1 },
    }, "spriteSourceSize.w must match"],
    [{
      sourceSize: { w: 2, h: 3 },
      spriteSourceSize: { x: 0, y: 0, w: 1, h: 2 },
    }, "spriteSourceSize.h must match"],
    [{
      sourceSize: { w: 2, h: 2 },
      spriteSourceSize: { x: 2, y: 0, w: 1, h: 1 },
    }, "is outside frames[0].sourceSize dimensions 2x2"],
    [{
      sourceSize: { w: 1, h: 1 },
      spriteSourceSize: { x: 0, y: 0, w: 1, h: 1 },
    }, "without trimming"],
  ])("rejects incomplete or inconsistent trim metadata %#", (trim, error) => {
    expect(() => parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{
        frame: { x: 0, y: 0, w: 1, h: 1 },
        trimmed: true,
        ...trim,
      }],
    }))).toThrow(error);
  });

  it("rejects rotated trim dimensions that do not match restored orientation", () => {
    expect(() => parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{
        frame: { x: 0, y: 0, w: 2, h: 3 },
        rotated: true,
        trimmed: true,
        sourceSize: { w: 4, h: 4 },
        spriteSourceSize: { x: 0, y: 0, w: 2, h: 3 },
      }],
    }))).toThrow(
      "frames[0].spriteSourceSize.w must match frames[0].frame.h when rotated is true.",
    );
  });

  it("rejects invalid JSON and empty frame collections", () => {
    expect(() => parseSpritesheetJsonMetadata("not json"))
      .toThrow("Spritesheet metadata is not valid JSON.");
    expect(() => parseSpritesheetJsonMetadata('{"frames":[]}'))
      .toThrow("TexturePacker Array metadata must contain at least one frame.");
  });

  it("distinguishes unsupported multi-atlas, incomplete, and unknown shapes", () => {
    expect(() => parseSpritesheetJsonMetadata(JSON.stringify({
      textures: [{ frames: [] }],
    }))).toThrow(
      "Phaser Multi-Atlas metadata is recognized but not supported because it contains nested atlas pages",
    );
    expect(() => parseSpritesheetJsonMetadata(JSON.stringify({
      meta: { app: "Aseprite" },
      frames: "missing collection",
    }))).toThrow(
      "Aseprite JSON metadata is incomplete: frames must be an array or object map.",
    );
    expect(() => parseSpritesheetJsonMetadata(JSON.stringify({
      textures: [{}],
    }))).toThrow("Phaser Multi-Atlas texture 1.frames must be an array.");
    expect(() => parseSpritesheetJsonMetadata('{"assets":[]}')).toThrow(
      "Atlas JSON schema is not recognized.",
    );
  });

  it("keeps object-map keys, arbitrary errors, and stack traces out of diagnostics", () => {
    const privateKey = "private-character-name.png";
    let error: unknown;

    try {
      parseSpritesheetJsonMetadata(JSON.stringify({
        frames: { [privateKey]: { frame: { x: -1, y: 0, w: 1, h: 1 } } },
      }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SpritesheetJsonImportError);
    expect(error).toMatchObject({ code: "invalid-field" });
    expect(getSpritesheetJsonImportDiagnostic(error)).toContain(
      "frames object entry 1.frame.x",
    );
    expect(getSpritesheetJsonImportDiagnostic(error)).not.toContain(privateKey);
    expect(getSpritesheetJsonImportDiagnostic(new Error("private JSON")))
      .toBeNull();
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
    expect(project.frameTags).toBeUndefined();
  });

  it("copies parsed frame tags into the SpriteProject in source order", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [
        { frame: { x: 0, y: 0, w: 1, h: 1 } },
        { frame: { x: 1, y: 0, w: 1, h: 1 } },
      ],
      meta: {
        app: "Aseprite",
        frameTags: [
          { name: "Second", from: 1, to: 1, direction: "reverse" },
          { name: "First", from: 0, to: 1, direction: "pingpong" },
        ],
      },
    }));

    const project = createSpritesheetJsonProject(
      createSpritesheet(2, 1),
      metadata,
    );

    expect(project.frameTags).toEqual([
      { name: "Second", from: 1, to: 1, direction: "reverse" },
      { name: "First", from: 0, to: 1, direction: "ping-pong" },
    ]);
    expect(project.frameTags).not.toBe(metadata.frameTags);
  });

  it("places trimmed pixels on a transparent full-size canvas", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{
        frame: { x: 1, y: 0, w: 2, h: 2 },
        duration: 85,
        trimmed: true,
        sourceSize: { w: 4, h: 4 },
        spriteSourceSize: { x: 1, y: 1, w: 2, h: 2 },
      }],
    }));

    const project = createSpritesheetJsonProject(
      createSpritesheet(3, 2),
      metadata,
    );
    const image = project.layers[0].cels[0].imageData;

    expect(project).toMatchObject({
      width: 4,
      height: 4,
      frames: [{ index: 0, durationMs: 85 }],
    });
    expect(image).toMatchObject({ width: 4, height: 4 });
    expect(Array.from(image.data).filter((_, index) => index % 4 === 0))
      .toEqual([
        0, 0, 0, 0,
        0, 2, 3, 0,
        0, 5, 6, 0,
        0, 0, 0, 0,
      ]);
    expect(Array.from(image.data).filter((_, index) => index % 4 === 3))
      .toEqual([
        0, 0, 0, 0,
        0, 255, 255, 0,
        0, 255, 255, 0,
        0, 0, 0, 0,
      ]);
  });

  it("restores TexturePacker rotation for asymmetric untrimmed pixels", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{
        frame: { x: 0, y: 0, w: 2, h: 3 },
        duration: 65,
        rotated: true,
      }],
    }));

    const project = createSpritesheetJsonProject(
      createSpritesheet(2, 3),
      metadata,
    );
    const image = project.layers[0].cels[0].imageData;

    expect(project).toMatchObject({
      width: 3,
      height: 2,
      frames: [{ index: 0, durationMs: 65 }],
    });
    expect(Array.from(image.data).filter((_, index) => index % 4 === 0))
      .toEqual([2, 4, 6, 1, 3, 5]);
  });

  it("restores rotation before placing a trimmed frame", () => {
    const metadata = parseSpritesheetJsonMetadata(JSON.stringify({
      frames: [{
        frame: { x: 0, y: 0, w: 2, h: 3 },
        rotated: true,
        trimmed: true,
        sourceSize: { w: 5, h: 4 },
        spriteSourceSize: { x: 1, y: 1, w: 3, h: 2 },
      }],
    }));

    const project = createSpritesheetJsonProject(
      createSpritesheet(2, 3),
      metadata,
    );
    const image = project.layers[0].cels[0].imageData;

    expect(project).toMatchObject({ width: 5, height: 4 });
    expect(Array.from(image.data).filter((_, index) => index % 4 === 0))
      .toEqual([
        0, 0, 0, 0, 0,
        0, 2, 4, 6, 0,
        0, 1, 3, 5, 0,
        0, 0, 0, 0, 0,
      ]);
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
