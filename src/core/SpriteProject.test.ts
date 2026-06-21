import { describe, expect, it } from "vitest";

import {
  MAX_FRAME_DURATION_MS,
  MIN_FRAME_DURATION_MS,
  updateFrameDuration,
  type SpriteProject,
} from "./SpriteProject";

describe("SpriteProject", () => {
  it("represents frames, layers, and positioned RGBA cel image data", () => {
    const imageData = {
      colorSpace: "srgb",
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      height: 1,
      width: 1,
    } satisfies ImageData;

    const project: SpriteProject = {
      width: 16,
      height: 16,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 100 },
        { index: 1, durationMs: 250 },
      ],
      layers: [
        {
          id: "main",
          name: "Main",
          visible: true,
          opacity: 192,
          cels: [
            {
              frameIndex: 1,
              x: 4,
              y: 6,
              imageData,
            },
          ],
        },
      ],
    };

    expect(project).toMatchObject({
      width: 16,
      height: 16,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 100 },
        { index: 1, durationMs: 250 },
      ],
      layers: [
        {
          id: "main",
          name: "Main",
          visible: true,
          opacity: 192,
          cels: [{ frameIndex: 1, x: 4, y: 6 }],
        },
      ],
    });
    expect(project.layers[0].cels[0].imageData).toBe(imageData);
  });

  it("updates only the selected frame duration without changing timeline order", () => {
    const project: SpriteProject = {
      width: 1,
      height: 1,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 80 },
        { index: 1, durationMs: 120 },
        { index: 2, durationMs: 160 },
      ],
      layers: [],
    };

    const updated = updateFrameDuration(project, 1, 240);

    expect(updated.frames).toEqual([
      { index: 0, durationMs: 80 },
      { index: 1, durationMs: 240 },
      { index: 2, durationMs: 160 },
    ]);
    expect(updated.frames[0]).toBe(project.frames[0]);
    expect(updated.frames[1]).not.toBe(project.frames[1]);
    expect(updated.frames[2]).toBe(project.frames[2]);
    expect(project.frames[1].durationMs).toBe(120);
    expect(updated.layers).toBe(project.layers);
  });

  it.each([MIN_FRAME_DURATION_MS, MAX_FRAME_DURATION_MS])(
    "accepts the documented frame duration bound %i",
    (durationMs) => {
      const project: SpriteProject = {
        width: 1,
        height: 1,
        colorMode: "rgba",
        frames: [{ index: 0, durationMs: 100 }],
        layers: [],
      };

      expect(updateFrameDuration(project, 0, durationMs).frames[0].durationMs)
        .toBe(durationMs);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 65_536])(
    "rejects an invalid frame duration %s",
    (durationMs) => {
      const project: SpriteProject = {
        width: 1,
        height: 1,
        colorMode: "rgba",
        frames: [{ index: 0, durationMs: 100 }],
        layers: [],
      };

      expect(() => updateFrameDuration(project, 0, durationMs)).toThrow(
        `Frame duration must be a whole number from ${MIN_FRAME_DURATION_MS} to ${MAX_FRAME_DURATION_MS} milliseconds.`,
      );
    },
  );

  it("rejects a frame index that is not in the project", () => {
    const project: SpriteProject = {
      width: 1,
      height: 1,
      colorMode: "rgba",
      frames: [{ index: 0, durationMs: 100 }],
      layers: [],
    };

    expect(() => updateFrameDuration(project, 3, 100)).toThrow(
      "Frame index 3 does not exist.",
    );
  });
});
