import { describe, expect, it } from "vitest";

import type { SpriteProject } from "./SpriteProject";

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
});
