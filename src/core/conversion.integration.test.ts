import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { SpriteProject } from "./SpriteProject";
import { exportAseprite } from "./exporters/aseprite";
import { importPngSequence } from "./importers/pngSequence";
import { importSpritesheetGrid } from "./importers/spritesheetGrid";
import { importSpritesheetJson } from "./importers/spritesheetJson";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type ParsedChunk = {
  bytes: Uint8Array;
  type: number;
};

type ParsedFrame = {
  chunks: ParsedChunk[];
  durationMs: number;
  magic: number;
};

function createFile(name: string, contents: BlobPart, type: string): File {
  return Object.assign(new Blob([contents], { type }), {
    lastModified: 0,
    name,
  }) as File;
}

function createImageData(redValues: number[]): ImageData {
  const data = new Uint8ClampedArray(redValues.length * 4);

  redValues.forEach((red, index) => {
    data[index * 4] = red;
    data[index * 4 + 3] = 255;
  });

  return {
    colorSpace: "srgb",
    data,
    height: 1,
    width: redValues.length,
  };
}

function parseFrames(bytes: Uint8Array): ParsedFrame[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameCount = view.getUint16(6, true);
  const frames: ParsedFrame[] = [];
  let frameOffset = 128;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameSize = view.getUint32(frameOffset, true);
    const oldChunkCount = view.getUint16(frameOffset + 6, true);
    const chunkCount =
      oldChunkCount === 0xffff
        ? view.getUint32(frameOffset + 12, true)
        : oldChunkCount;
    const chunks: ParsedChunk[] = [];
    let chunkOffset = frameOffset + 16;

    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunkSize = view.getUint32(chunkOffset, true);
      chunks.push({
        bytes: bytes.slice(chunkOffset, chunkOffset + chunkSize),
        type: view.getUint16(chunkOffset + 4, true),
      });
      chunkOffset += chunkSize;
    }

    expect(chunkOffset).toBe(frameOffset + frameSize);
    frames.push({
      chunks,
      durationMs: view.getUint16(frameOffset + 8, true),
      magic: view.getUint16(frameOffset + 4, true),
    });
    frameOffset += frameSize;
  }

  expect(frameOffset).toBe(bytes.length);
  return frames;
}

function expectTwoFrameAseprite(
  project: SpriteProject,
  expectedDurations: number[],
  expectedRedValues: number[],
): void {
  const bytes = exportAseprite(project);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = parseFrames(bytes);

  expect({
    colorDepth: view.getUint16(12, true),
    declaredSize: view.getUint32(0, true),
    frameCount: view.getUint16(6, true),
    height: view.getUint16(10, true),
    magic: view.getUint16(4, true),
    width: view.getUint16(8, true),
  }).toEqual({
    colorDepth: 32,
    declaredSize: bytes.length,
    frameCount: 2,
    height: 1,
    magic: 0xa5e0,
    width: 1,
  });
  expect(frames.map(({ durationMs, magic }) => ({ durationMs, magic }))).toEqual(
    expectedDurations.map((durationMs) => ({ durationMs, magic: 0xf1fa })),
  );
  expect(frames.map(({ chunks }) => chunks.map(({ type }) => type))).toEqual([
    [0x2004, 0x2005],
    [0x2005],
  ]);

  const celChunks = frames.flatMap(({ chunks }) =>
    chunks.filter(({ type }) => type === 0x2005),
  );
  expect(
    celChunks.map(({ bytes: celBytes }) => {
      const celView = new DataView(
        celBytes.buffer,
        celBytes.byteOffset,
        celBytes.byteLength,
      );
      return {
        height: celView.getUint16(24, true),
        pixels: Array.from(inflateSync(celBytes.slice(26))),
        width: celView.getUint16(22, true),
      };
    }),
  ).toEqual(
    expectedRedValues.map((red) => ({
      height: 1,
      pixels: [red, 0, 0, 255],
      width: 1,
    })),
  );
}

describe("importer to Aseprite export integration", () => {
  it("converts a synthetic PNG sequence into an Aseprite timeline", async () => {
    const files = [
      createFile("frame-1.png", PNG_SIGNATURE, "image/png"),
      createFile("frame-2.png", PNG_SIGNATURE, "image/png"),
    ];
    const images = new Map([
      [files[0], createImageData([10])],
      [files[1], createImageData([20])],
    ]);
    const project = await importPngSequence(
      files,
      { frameDurationMs: 80 },
      { decodePng: async (file) => images.get(file)! },
    );

    expectTwoFrameAseprite(project, [80, 80], [10, 20]);
  });

  it("converts a synthetic spritesheet grid into Aseprite frames", async () => {
    const file = createFile("grid.png", PNG_SIGNATURE, "image/png");
    const project = await importSpritesheetGrid(
      file,
      {
        columns: 2,
        frameDurationMs: 70,
        frameHeight: 1,
        frameOrder: "row-major",
        frameWidth: 1,
        rows: 1,
      },
      { decodePng: async () => createImageData([30, 40]) },
    );

    expectTwoFrameAseprite(project, [70, 70], [30, 40]);
  });

  it("converts synthetic spritesheet JSON metadata into Aseprite frames", async () => {
    const spritesheetFile = createFile(
      "metadata.png",
      PNG_SIGNATURE,
      "image/png",
    );
    const metadataFile = createFile(
      "metadata.json",
      JSON.stringify({
        frames: [
          { duration: 90, frame: { h: 1, w: 1, x: 1, y: 0 } },
          { duration: 120, frame: { h: 1, w: 1, x: 0, y: 0 } },
        ],
      }),
      "application/json",
    );
    const project = await importSpritesheetJson(
      spritesheetFile,
      metadataFile,
      {},
      { decodePng: async () => createImageData([50, 60]) },
    );

    expectTwoFrameAseprite(project, [90, 120], [60, 50]);
  });
});
