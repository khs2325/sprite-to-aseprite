import { describe, expect, it } from "vitest";

import type { SpriteProject } from "../SpriteProject";
import { isValidSpriteProject, validateSpriteProject } from ".";

function createImageData(width = 1, height = 1): ImageData {
  return {
    colorSpace: "srgb",
    data: new Uint8ClampedArray(width * height * 4),
    height,
    width,
  };
}

function createValidProject(): SpriteProject {
  return {
    width: 4,
    height: 4,
    colorMode: "rgba",
    frames: [
      { index: 0, durationMs: 100 },
      { index: 1, durationMs: 150 },
    ],
    layers: [
      {
        id: "main",
        name: "Main",
        visible: true,
        opacity: 255,
        cels: [
          {
            frameIndex: 1,
            x: 1,
            y: 1,
            imageData: createImageData(2, 2),
          },
        ],
      },
    ],
  };
}

describe("validateSpriteProject", () => {
  it("accepts a valid project", () => {
    const project: unknown = createValidProject();

    expect(validateSpriteProject(project)).toEqual([]);
    expect(isValidSpriteProject(project)).toBe(true);
  });

  it.each([
    ["width", 0, "invalid_width"],
    ["height", 1.5, "invalid_height"],
  ] as const)("rejects an invalid %s", (dimension, value, code) => {
    const project = createValidProject();
    project[dimension] = value;

    expect(validateSpriteProject(project)).toContainEqual(
      expect.objectContaining({ code, path: dimension }),
    );
  });

  it("rejects invalid frame indexes and durations", () => {
    const project = createValidProject();
    project.frames[1] = { index: -1, durationMs: 0 };

    expect(validateSpriteProject(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_frame_index",
          path: "frames[1].index",
        }),
        expect.objectContaining({
          code: "invalid_frame_duration",
          path: "frames[1].durationMs",
        }),
      ]),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 65_536])(
    "rejects an out-of-range frame duration %s",
    (durationMs) => {
      const project = createValidProject();
      project.frames[0].durationMs = durationMs;

      expect(validateSpriteProject(project)).toContainEqual(
        expect.objectContaining({
          code: "invalid_frame_duration",
          path: "frames[0].durationMs",
          message:
            "Frame duration must be a whole number from 1 to 65535 milliseconds.",
        }),
      );
    },
  );

  it("rejects malformed layer data and opacity", () => {
    const project = createValidProject() as unknown as Record<string, unknown>;
    project.layers = [
      {
        id: "",
        name: 12,
        visible: "yes",
        opacity: 256,
        cels: "not-an-array",
      },
    ];

    expect(validateSpriteProject(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_layer_id" }),
        expect.objectContaining({ code: "invalid_layer_name" }),
        expect.objectContaining({ code: "invalid_layer_visibility" }),
        expect.objectContaining({ code: "invalid_layer_opacity" }),
        expect.objectContaining({ code: "invalid_cels" }),
      ]),
    );
  });

  it.each(["", "   "])("rejects an empty layer name %j", (name) => {
    const project = createValidProject();
    project.layers[0].name = name;

    expect(validateSpriteProject(project)).toContainEqual({
      code: "invalid_layer_name",
      path: "layers[0].name",
      message: "Layer name must contain at least one non-whitespace character.",
    });
  });

  it("rejects a cel that references a missing frame", () => {
    const project = createValidProject();
    project.layers[0].cels[0].frameIndex = 8;

    expect(validateSpriteProject(project)).toContainEqual(
      expect.objectContaining({
        code: "invalid_cel_frame_reference",
        path: "layers[0].cels[0].frameIndex",
      }),
    );
  });

  it("rejects invalid cel placement and RGBA data", () => {
    const project = createValidProject();
    const cel = project.layers[0].cels[0];
    cel.x = 3;
    cel.y = -1;
    cel.imageData = {
      ...createImageData(2, 2),
      data: new Uint8ClampedArray(3),
    };

    expect(validateSpriteProject(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_cel_image_data" }),
        expect.objectContaining({ code: "invalid_cel_y" }),
      ]),
    );
  });

  it("rejects a cel image that extends beyond the canvas", () => {
    const project = createValidProject();
    project.layers[0].cels[0].x = 3;

    expect(validateSpriteProject(project)).toContainEqual(
      expect.objectContaining({
        code: "cel_out_of_bounds",
        path: "layers[0].cels[0].x",
      }),
    );
  });

  it("returns a clear error instead of throwing for non-object input", () => {
    expect(validateSpriteProject(null)).toEqual([
      {
        code: "invalid_project",
        path: "project",
        message: "Project must be an object.",
      },
    ]);
    expect(isValidSpriteProject(null)).toBe(false);
  });
});
