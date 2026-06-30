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

  it("accepts ordered model data and preserves validation input order", () => {
    const project: SpriteProject = {
      width: 4,
      height: 3,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 80 },
        { index: 1, durationMs: 120 },
        { index: 2, durationMs: 160 },
      ],
      layers: [
        {
          id: "shadow",
          name: "Shadow",
          visible: false,
          opacity: 0,
          cels: [
            { frameIndex: 0, x: 0, y: 0, imageData: createImageData(4, 3) },
          ],
        },
        {
          id: "ink",
          name: "Ink",
          visible: true,
          opacity: 255,
          cels: [
            { frameIndex: 2, x: 2, y: 1, imageData: createImageData(2, 2) },
            { frameIndex: 1, x: 3, y: 2, imageData: createImageData(1, 1) },
          ],
        },
      ],
    };

    expect(validateSpriteProject(project)).toEqual([]);
    expect(project.frames.map(({ index }) => index)).toEqual([0, 1, 2]);
    expect(project.layers.map(({ id, opacity, visible }) => ({
      id,
      opacity,
      visible,
    }))).toEqual([
      { id: "shadow", opacity: 0, visible: false },
      { id: "ink", opacity: 255, visible: true },
    ]);
    expect(project.layers[1].cels.map(({ frameIndex }) => frameIndex))
      .toEqual([2, 1]);
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

  it("rejects frames that are not zero-based and ordered", () => {
    const project = createValidProject();
    project.frames = [
      { index: 0, durationMs: 100 },
      { index: 0, durationMs: 150 },
    ];

    expect(validateSpriteProject(project)).toContainEqual(
      expect.objectContaining({
        code: "invalid_frame_index",
        path: "frames[1].index",
        message: "Frame index must be 1 to keep frames zero-based and ordered.",
      }),
    );
  });

  it("accepts ordered frame tags and exact case-distinct names", () => {
    const project = createValidProject();
    project.frameTags = [
      { name: "Loop", from: 0, to: 1, direction: "forward" },
      { name: "loop", from: 1, to: 1, direction: "reverse" },
      { name: "Bounce", from: 0, to: 1, direction: "ping-pong" },
    ];

    expect(validateSpriteProject(project)).toEqual([]);
  });

  it("rejects malformed frame tag fields and duplicate exact names", () => {
    const project = createValidProject() as unknown as Record<string, unknown>;
    project.frameTags = [
      { name: "", from: -1, to: 1, direction: "sideways" },
      { name: "Loop", from: 1, to: 0, direction: "forward" },
      { name: "Loop", from: 0, to: 1, direction: "reverse" },
      { name: "Unsafe", from: Number.MAX_SAFE_INTEGER + 1, to: 1 },
    ];

    expect(validateSpriteProject(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_frame_tag_name",
          path: "frameTags[0].name",
        }),
        expect.objectContaining({
          code: "invalid_frame_tag_from",
          path: "frameTags[0].from",
        }),
        expect.objectContaining({
          code: "invalid_frame_tag_direction",
          path: "frameTags[0].direction",
        }),
        expect.objectContaining({
          code: "invalid_frame_tag_range",
          path: "frameTags[1]",
        }),
        expect.objectContaining({
          code: "duplicate_frame_tag_name",
          path: "frameTags[2].name",
        }),
        expect.objectContaining({
          code: "invalid_frame_tag_from",
          path: "frameTags[3].from",
        }),
      ]),
    );
  });

  it("rejects frame tag indexes that do not reference project frames", () => {
    const project = createValidProject();
    project.frameTags = [
      { name: "Missing start", from: 2, to: 2, direction: "forward" },
    ];

    expect(validateSpriteProject(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_frame_tag_reference",
          path: "frameTags[0].from",
        }),
        expect.objectContaining({
          code: "invalid_frame_tag_reference",
          path: "frameTags[0].to",
        }),
      ]),
    );
  });

  it("rejects a non-array frame tag collection", () => {
    const project = createValidProject() as unknown as Record<string, unknown>;
    project.frameTags = "Loop";

    expect(validateSpriteProject(project)).toContainEqual({
      code: "invalid_frame_tags",
      path: "frameTags",
      message: "Project frame tags must be an array when provided.",
    });
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

  it.each([-1, 1.5, Number.NaN, 256])(
    "rejects an invalid layer opacity %s",
    (opacity) => {
      const project = createValidProject();
      project.layers[0].opacity = opacity;

      expect(validateSpriteProject(project)).toContainEqual({
        code: "invalid_layer_opacity",
        path: "layers[0].opacity",
        message: "Layer opacity must be an integer from 0 to 255.",
      });
    },
  );

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

  it("rejects duplicate cel frame indexes within a layer", () => {
    const project = createValidProject();
    project.layers[0].cels.push({
      frameIndex: 1,
      x: 0,
      y: 0,
      imageData: createImageData(),
    });

    expect(validateSpriteProject(project)).toContainEqual(
      expect.objectContaining({
        code: "duplicate_cel_frame",
        path: "layers[0].cels[1].frameIndex",
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

    expect(validateSpriteProject(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cel_out_of_bounds",
          path: "layers[0].cels[0].x",
        }),
      ]),
    );
  });

  it("rejects a cel image that extends below the canvas", () => {
    const project = createValidProject();
    project.layers[0].cels[0].y = 3;

    expect(validateSpriteProject(project)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "cel_out_of_bounds",
          path: "layers[0].cels[0].y",
        }),
      ]),
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
