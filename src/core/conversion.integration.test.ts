import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { SpriteProject } from "./SpriteProject";
import { exportAseprite } from "./exporters/aseprite";
import { importPiskel } from "./importers/piskel";
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

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function decodeFixturePng(bytes: Uint8Array): ImageData {
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  const compressed: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUint32BigEndian(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      width = readUint32BigEndian(data, 0);
      height = readUint32BigEndian(data, 4);
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const rows = inflateSync(
    Buffer.concat(compressed.map((part) => Buffer.from(part))),
  );
  const data = new Uint8ClampedArray(width * height * 4);
  const rowLength = width * 4;

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (rowLength + 1);
    if (rows[sourceOffset] !== 0) {
      throw new Error("Test decoder only supports unfiltered fixture rows.");
    }
    data.set(
      rows.subarray(sourceOffset + 1, sourceOffset + 1 + rowLength),
      row * rowLength,
    );
  }

  return { colorSpace: "srgb", data, height, width };
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
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

  it("rebuilds trimmed atlas frames before Aseprite export", async () => {
    const atlasBytes = new Uint8Array(readFileSync(new URL(
      "../../tests/fixtures/spritesheet/trimmed-atlas.png",
      import.meta.url,
    )));
    const metadata = readFileSync(new URL(
      "../../tests/fixtures/spritesheet/trimmed-atlas.json",
      import.meta.url,
    ), "utf8");
    const project = await importSpritesheetJson(
      createFile("trimmed-atlas.png", atlasBytes, "image/png"),
      createFile("trimmed-atlas.json", metadata, "application/json"),
      {},
      { decodePng: async () => decodeFixturePng(atlasBytes) },
    );

    expect(project).toMatchObject({
      width: 4,
      height: 4,
      frames: [
        { index: 0, durationMs: 125 },
        { index: 1, durationMs: 75 },
      ],
    });
    expect(pixel(project.layers[0].cels[0].imageData, 2, 0))
      .toEqual([255, 209, 102, 255]);
    expect(pixel(project.layers[0].cels[0].imageData, 2, 1))
      .toEqual([0, 0, 0, 0]);
    expect(pixel(project.layers[0].cels[1].imageData, 1, 2))
      .toEqual([17, 138, 178, 255]);
    expect(pixel(project.layers[0].cels[1].imageData, 0, 2))
      .toEqual([0, 0, 0, 0]);

    const bytes = exportAseprite(project);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect({
      frameCount: view.getUint16(6, true),
      height: view.getUint16(10, true),
      width: view.getUint16(8, true),
    }).toEqual({ frameCount: 2, height: 4, width: 4 });
    expect(parseFrames(bytes).map(({ durationMs }) => durationMs))
      .toEqual([125, 75]);
  });

  it("preserves supported Piskel layers and timing in Aseprite chunks", async () => {
    const contents = readFileSync(
      new URL("../../tests/fixtures/piskel/multi-layer.piskel", import.meta.url),
      "utf8",
    );
    const file = createFile(
      "multi-layer.piskel",
      contents,
      "application/json",
    );
    const project = await importPiskel(file, {
      decodePng: async (bytes) => decodeFixturePng(bytes),
    });

    expect(project).toMatchObject({
      colorMode: "rgba",
      frames: [
        { index: 0, durationMs: 50 },
        { index: 1, durationMs: 50 },
      ],
      height: 2,
      layers: [
        {
          cels: [
            { frameIndex: 0, x: 0, y: 0 },
            { frameIndex: 1, x: 0, y: 0 },
          ],
          name: "Background",
          opacity: 128,
          visible: true,
        },
        {
          cels: [
            { frameIndex: 0, x: 0, y: 0 },
            { frameIndex: 1, x: 0, y: 0 },
          ],
          name: "Accent",
          opacity: 255,
          visible: true,
        },
      ],
      width: 2,
    });
    expect(pixel(project.layers[0].cels[0].imageData, 0, 0)).toEqual([
      69, 123, 157, 255,
    ]);
    expect(pixel(project.layers[0].cels[1].imageData, 0, 0)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(pixel(project.layers[1].cels[0].imageData, 0, 0)).toEqual([
      230, 57, 70, 255,
    ]);
    expect(pixel(project.layers[1].cels[1].imageData, 1, 0)).toEqual([
      42, 157, 143, 255,
    ]);

    const bytes = exportAseprite(project);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frames = parseFrames(bytes);
    expect(exportAseprite(project)).toEqual(bytes);
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
      height: 2,
      magic: 0xa5e0,
      width: 2,
    });
    expect(frames.map(({ durationMs, magic }) => ({ durationMs, magic }))).toEqual([
      { durationMs: 50, magic: 0xf1fa },
      { durationMs: 50, magic: 0xf1fa },
    ]);
    expect(frames.map(({ chunks }) => chunks.map(({ type }) => type))).toEqual([
      [0x2004, 0x2004, 0x2005, 0x2005],
      [0x2005, 0x2005],
    ]);

    const layerChunks = frames[0].chunks.filter(({ type }) => type === 0x2004);
    expect(
      layerChunks.map(({ bytes: layerBytes }) => {
        const layerView = new DataView(
          layerBytes.buffer,
          layerBytes.byteOffset,
          layerBytes.byteLength,
        );
        const nameLength = layerView.getUint16(22, true);
        return {
          name: new TextDecoder().decode(layerBytes.slice(24, 24 + nameLength)),
          opacity: layerView.getUint8(18),
          visible: (layerView.getUint16(6, true) & 1) !== 0,
        };
      }),
    ).toEqual([
      { name: "Background", opacity: 128, visible: true },
      { name: "Accent", opacity: 255, visible: true },
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
          layerIndex: celView.getUint16(6, true),
          pixels: Array.from(inflateSync(celBytes.slice(26))),
          width: celView.getUint16(22, true),
          x: celView.getInt16(8, true),
          y: celView.getInt16(10, true),
        };
      }),
    ).toEqual([
      {
        height: 2,
        layerIndex: 0,
        pixels: [
          69, 123, 157, 255, 69, 123, 157, 255, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        width: 2,
        x: 0,
        y: 0,
      },
      {
        height: 2,
        layerIndex: 1,
        pixels: [
          230, 57, 70, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        width: 2,
        x: 0,
        y: 0,
      },
      {
        height: 2,
        layerIndex: 0,
        pixels: [
          0, 0, 0, 0, 0, 0, 0, 0, 69, 123, 157, 255, 69, 123, 157, 255,
        ],
        width: 2,
        x: 0,
        y: 0,
      },
      {
        height: 2,
        layerIndex: 1,
        pixels: [
          0, 0, 0, 0, 42, 157, 143, 255, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        width: 2,
        x: 0,
        y: 0,
      },
    ]);
  });

  it("omits hidden Piskel frames and exports reindexed visible frames", async () => {
    const contents = readFileSync(
      new URL(
        "../../tests/fixtures/piskel/hidden-multi-layer.piskel",
        import.meta.url,
      ),
      "utf8",
    );
    const project = await importPiskel(
      createFile("hidden-multi-layer.piskel", contents, "application/json"),
      { decodePng: async (bytes) => decodeFixturePng(bytes) },
    );

    expect(project.frames).toEqual([{ index: 0, durationMs: 50 }]);
    expect(project.layers.map(({ name, opacity, visible, cels }) => ({
      name,
      opacity,
      visible,
      frameIndexes: cels.map(({ frameIndex }) => frameIndex),
    }))).toEqual([
      {
        name: "Background",
        opacity: 128,
        visible: true,
        frameIndexes: [0],
      },
      {
        name: "Accent",
        opacity: 255,
        visible: true,
        frameIndexes: [0],
      },
    ]);

    const bytes = exportAseprite(project);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frames = parseFrames(bytes);
    expect(view.getUint16(6, true)).toBe(1);
    expect(frames).toHaveLength(1);
    expect(frames[0].durationMs).toBe(50);
    expect(frames[0].chunks.map(({ type }) => type)).toEqual([
      0x2004, 0x2004, 0x2005, 0x2005,
    ]);
  });

  it("rejects malformed Piskel input at the conversion boundary", async () => {
    const file = createFile(
      "malformed.piskel",
      '{"modelVersion":2,"piskel":',
      "application/json",
    );

    await expect(importPiskel(file)).rejects.toThrow(
      "Piskel file is not valid JSON.",
    );
  });
});
