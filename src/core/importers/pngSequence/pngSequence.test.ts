import { describe, expect, it, vi } from "vitest";

import {
  createPngSequenceProject,
  importPngSequence,
} from ".";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function createImageData(
  width: number,
  height: number,
  red: number,
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  data[0] = red;

  return { colorSpace: "srgb", data, height, width };
}

function createSyntheticPngFile(name: string): File {
  const blob = new Blob([PNG_SIGNATURE], { type: "image/png" });

  return Object.assign(blob, { lastModified: 0, name }) as File;
}

describe("createPngSequenceProject", () => {
  it("rebuilds ordered image data as a single-layer timeline", () => {
    const first = createImageData(2, 3, 10);
    const second = createImageData(2, 3, 20);

    const project = createPngSequenceProject([first, second], {
      frameDurationMs: 125,
    });

    expect(project).toMatchObject({
      width: 2,
      height: 3,
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 125 },
        { index: 1, durationMs: 125 },
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
          ],
        },
      ],
    });
    expect(project.layers).toHaveLength(1);
    expect(project.layers[0].cels[0].imageData).toBe(first);
    expect(project.layers[0].cels[1].imageData).toBe(second);
  });

  it("rejects inconsistent frame dimensions", () => {
    expect(() =>
      createPngSequenceProject([
        createImageData(2, 3, 10),
        createImageData(3, 3, 20),
      ]),
    ).toThrow(
      "Frame 2 dimensions 3x3 do not match the first frame dimensions 2x3.",
    );
  });

  it("uses the default frame duration when metadata is omitted", () => {
    const project = createPngSequenceProject([
      createImageData(1, 1, 10),
      createImageData(1, 1, 20),
    ]);

    expect(project.frames.map(({ durationMs }) => durationMs)).toEqual([
      100,
      100,
    ]);
  });

  it.each([
    [0, 1],
    [1, 0],
    [1.5, 1],
  ])("rejects invalid frame dimensions %sx%s", (width, height) => {
    expect(() =>
      createPngSequenceProject([createImageData(width, height, 10)]),
    ).toThrow("Frame 1 contains invalid RGBA image data.");
  });

  it("rejects empty sequences", () => {
    expect(() => createPngSequenceProject([])).toThrow(
      "PNG sequence must contain at least one frame.",
    );
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid frame duration %s",
    (frameDurationMs) => {
      expect(() =>
        createPngSequenceProject([createImageData(1, 1, 10)], {
          frameDurationMs,
        }),
      ).toThrow("Frame duration must be a positive integer in milliseconds.");
    },
  );
});

describe("importPngSequence", () => {
  it("preserves browser-local file ordering", async () => {
    const files = [
      createSyntheticPngFile("frame-2.png"),
      createSyntheticPngFile("frame-1.png"),
    ];
    const images = [createImageData(1, 1, 20), createImageData(1, 1, 10)];
    const decodePng = vi
      .fn<(file: File) => Promise<ImageData>>()
      .mockResolvedValueOnce(images[0])
      .mockResolvedValueOnce(images[1]);

    const project = await importPngSequence(files, {}, { decodePng });

    expect(decodePng.mock.calls.map(([file]) => file.name)).toEqual([
      "frame-2.png",
      "frame-1.png",
    ]);
    expect(project.layers[0].cels.map((cel) => cel.imageData)).toEqual(images);
  });

  it("rejects files without a PNG signature before decoding", async () => {
    const invalidFile = Object.assign(new Blob(["not a png"]), {
      lastModified: 0,
      name: "frame.png",
    }) as File;
    const decodePng = vi.fn<(file: File) => Promise<ImageData>>();

    await expect(
      importPngSequence([invalidFile], {}, { decodePng }),
    ).rejects.toThrow("Frame 1 (frame.png) is not a PNG file.");
    expect(decodePng).not.toHaveBeenCalled();
  });
});
