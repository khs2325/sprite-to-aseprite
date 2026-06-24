import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { createPngSequenceProject } from "../../src/core/importers/pngSequence";
import { createSpritesheetGridProject } from "../../src/core/importers/spritesheetGrid";
import {
  createSpritesheetJsonProject,
  parseSpritesheetJsonMetadata,
} from "../../src/core/importers/spritesheetJson";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

type PiskelChunkFixture = {
  layout: number[][];
  base64PNG: string;
};

type PiskelLayerFixture = {
  name: string;
  opacity: number;
  frameCount: number;
  chunks: PiskelChunkFixture[];
  visible?: boolean;
};

type PiskelFixture = {
  modelVersion: number;
  piskel: {
    name: string;
    description: string;
    fps: number;
    height: number;
    width: number;
    layers: string[];
    hiddenFrames: number[];
  };
};

type GifFrameFixtureMetadata = {
  delayCentiseconds: number;
  disposal: number;
  height: number;
  interlaced: boolean;
  left: number;
  lzwMinimumCodeSize: number;
  top: number;
  transparentIndex: number | null;
  width: number;
};

type GifFixtureMetadata = {
  backgroundColorIndex: number;
  frames: GifFrameFixtureMetadata[];
  height: number;
  loopCount: number | null;
  pixelAspectRatio: number;
  signature: string;
  width: number;
};

function inspectGifFixture(relativePath: string): GifFixtureMetadata {
  const gif = readFileSync(join(fixtureDirectory, relativePath));
  const signature = gif.toString("ascii", 0, 6);
  expect(signature).toBe("GIF89a");

  const width = gif.readUInt16LE(6);
  const height = gif.readUInt16LE(8);
  const logicalScreenPacked = gif[10];
  const backgroundColorIndex = gif[11];
  const pixelAspectRatio = gif[12];
  expect(logicalScreenPacked & 0x80).toBe(0x80);

  const globalColorTableEntries = 1 << ((logicalScreenPacked & 0x07) + 1);
  let offset = 13 + globalColorTableEntries * 3;
  let loopCount: number | null = null;
  let pendingControl: Pick<
    GifFrameFixtureMetadata,
    "delayCentiseconds" | "disposal" | "transparentIndex"
  > | null = null;
  const frames: GifFrameFixtureMetadata[] = [];

  const readSubBlocks = (): Buffer => {
    const blocks: Buffer[] = [];
    while (true) {
      const length = gif[offset];
      offset += 1;
      expect(length).toBeDefined();
      if (length === 0) {
        return Buffer.concat(blocks);
      }
      expect(offset + length).toBeLessThanOrEqual(gif.length);
      blocks.push(gif.subarray(offset, offset + length));
      offset += length;
    }
  };

  while (gif[offset] !== 0x3b) {
    expect(offset).toBeLessThan(gif.length);
    const introducer = gif[offset];

    if (introducer === 0x21 && gif[offset + 1] === 0xf9) {
      expect(gif[offset + 2]).toBe(4);
      const packed = gif[offset + 3];
      pendingControl = {
        delayCentiseconds: gif.readUInt16LE(offset + 4),
        disposal: (packed >> 2) & 0x07,
        transparentIndex: (packed & 0x01) === 0 ? null : gif[offset + 6],
      };
      expect(gif[offset + 7]).toBe(0);
      offset += 8;
      continue;
    }

    if (introducer === 0x21 && gif[offset + 1] === 0xff) {
      expect(gif[offset + 2]).toBe(11);
      const identifier = gif.toString("ascii", offset + 3, offset + 14);
      offset += 14;
      const applicationData = readSubBlocks();
      if (identifier === "NETSCAPE2.0") {
        expect([...applicationData.subarray(0, 1)]).toEqual([1]);
        expect(applicationData).toHaveLength(3);
        loopCount = applicationData.readUInt16LE(1);
      }
      continue;
    }

    expect(introducer).toBe(0x2c);
    const left = gif.readUInt16LE(offset + 1);
    const top = gif.readUInt16LE(offset + 3);
    const frameWidth = gif.readUInt16LE(offset + 5);
    const frameHeight = gif.readUInt16LE(offset + 7);
    const imagePacked = gif[offset + 9];
    offset += 10;
    if ((imagePacked & 0x80) !== 0) {
      offset += (1 << ((imagePacked & 0x07) + 1)) * 3;
    }
    const lzwMinimumCodeSize = gif[offset];
    offset += 1;
    expect(readSubBlocks().length).toBeGreaterThan(0);

    frames.push({
      delayCentiseconds: pendingControl?.delayCentiseconds ?? 0,
      disposal: pendingControl?.disposal ?? 0,
      height: frameHeight,
      interlaced: (imagePacked & 0x40) !== 0,
      left,
      lzwMinimumCodeSize,
      top,
      transparentIndex: pendingControl?.transparentIndex ?? null,
      width: frameWidth,
    });
    pendingControl = null;
  }

  expect(gif[offset]).toBe(0x3b);
  expect(offset).toBe(gif.length - 1);
  return {
    backgroundColorIndex,
    frames,
    height,
    loopCount,
    pixelAspectRatio,
    signature,
    width,
  };
}

function normalizeGifFixtureDelay(delayCentiseconds: number): number {
  if (delayCentiseconds === 0) {
    return 100;
  }
  return Math.max(20, Math.min(65_535, delayCentiseconds * 10));
}

function decodePng(png: Buffer): ImageData {
  expect(png.subarray(0, 8)).toEqual(pngSignature);

  let offset = 8;
  let width = 0;
  let height = 0;
  const compressedData: Buffer[] = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    } else if (type === "IDAT") {
      compressedData.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const rows = inflateSync(Buffer.concat(compressedData));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const rowLength = width * 4;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (rowLength + 1);
    expect(rows[rowOffset]).toBe(0);
    pixels.set(rows.subarray(rowOffset + 1, rowOffset + 1 + rowLength), y * rowLength);
  }

  return { colorSpace: "srgb", data: pixels, height, width };
}

function decodeFixturePng(relativePath: string): ImageData {
  return decodePng(readFileSync(join(fixtureDirectory, relativePath)));
}

function parsePiskelFixture(relativePath: string): {
  fixture: PiskelFixture;
  layers: PiskelLayerFixture[];
} {
  const fixture = JSON.parse(
    readFileSync(join(fixtureDirectory, relativePath), "utf8"),
  ) as PiskelFixture;
  return {
    fixture,
    layers: fixture.piskel.layers.map(
      (layer) => JSON.parse(layer) as PiskelLayerFixture,
    ),
  };
}

function decodePiskelChunk(chunk: PiskelChunkFixture): ImageData {
  const prefix = "data:image/png;base64,";
  expect(chunk.base64PNG.startsWith(prefix)).toBe(true);
  const payload = chunk.base64PNG.slice(prefix.length);
  expect(payload).toMatch(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
  );
  const png = Buffer.from(payload, "base64");
  expect(png.toString("base64")).toBe(payload);
  return decodePng(png);
}

function expectPiskelFixtureShape(
  fixture: PiskelFixture,
  layers: PiskelLayerFixture[],
): void {
  expect(Object.keys(fixture).sort()).toEqual(["modelVersion", "piskel"]);
  expect(Object.keys(fixture.piskel).sort()).toEqual([
    "description",
    "fps",
    "height",
    "hiddenFrames",
    "layers",
    "name",
    "width",
  ]);
  expect(fixture.piskel.layers).toHaveLength(layers.length);
  expect(
    fixture.piskel.layers.every((layer) => typeof layer === "string"),
  ).toBe(true);

  const frameCount = layers[0].frameCount;
  for (const layer of layers) {
    expect(Object.keys(layer).sort()).toEqual([
      "chunks",
      "frameCount",
      "name",
      "opacity",
    ]);
    expect(layer.frameCount).toBe(frameCount);
    expect(layer.chunks.length).toBeGreaterThan(0);
    const frameIndexes: number[] = [];

    for (const chunk of layer.chunks) {
      expect(Object.keys(chunk).sort()).toEqual(["base64PNG", "layout"]);
      expect(chunk.layout.length).toBeGreaterThan(0);
      const rowCount = chunk.layout[0].length;
      expect(rowCount).toBeGreaterThan(0);
      expect(
        chunk.layout.every((column) => column.length === rowCount),
      ).toBe(true);
      frameIndexes.push(...chunk.layout.flat());

      const image = decodePiskelChunk(chunk);
      expect(image.width).toBe(fixture.piskel.width * chunk.layout.length);
      expect(image.height).toBe(fixture.piskel.height * rowCount);
    }

    expect(frameIndexes.sort((left, right) => left - right)).toEqual(
      Array.from({ length: frameCount }, (_, index) => index),
    );
  }
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

describe("synthetic sprite fixtures", () => {
  it("provides GIF89a timing, transparency, offsets, and loop metadata", () => {
    const gif = inspectGifFixture("gif/timing-transparency-offsets.gif");

    expect(gif).toMatchObject({
      signature: "GIF89a",
      width: 3,
      height: 2,
      backgroundColorIndex: 0,
      pixelAspectRatio: 0,
      loopCount: 0,
    });
    expect(gif.frames.map((frame) => ({
      rectangle: [frame.left, frame.top, frame.width, frame.height],
      delay: frame.delayCentiseconds,
      disposal: frame.disposal,
      transparentIndex: frame.transparentIndex,
      interlaced: frame.interlaced,
      lzwMinimumCodeSize: frame.lzwMinimumCodeSize,
    }))).toEqual([
      { rectangle: [0, 0, 3, 2], delay: 0, disposal: 1, transparentIndex: 0, interlaced: false, lzwMinimumCodeSize: 2 },
      { rectangle: [1, 0, 2, 1], delay: 1, disposal: 1, transparentIndex: 0, interlaced: false, lzwMinimumCodeSize: 2 },
      { rectangle: [2, 1, 1, 1], delay: 12, disposal: 1, transparentIndex: 0, interlaced: false, lzwMinimumCodeSize: 2 },
      { rectangle: [0, 1, 1, 1], delay: 65_535, disposal: 1, transparentIndex: 0, interlaced: false, lzwMinimumCodeSize: 2 },
    ]);
    expect(gif.frames.map(({ delayCentiseconds }) =>
      normalizeGifFixtureDelay(delayCentiseconds)))
      .toEqual([100, 20, 120, 65_535]);
  });

  it("provides GIF89a background and previous disposal sequences", () => {
    const background = inspectGifFixture("gif/disposal-background.gif");
    const previous = inspectGifFixture("gif/disposal-previous.gif");

    expect(background.frames.map(({ left, top, width, height, disposal }) => ({
      rectangle: [left, top, width, height],
      disposal,
    }))).toEqual([
      { rectangle: [0, 0, 3, 2], disposal: 1 },
      { rectangle: [1, 0, 1, 1], disposal: 2 },
      { rectangle: [2, 0, 1, 1], disposal: 1 },
    ]);
    expect(previous.frames.map(({ left, top, width, height, disposal }) => ({
      rectangle: [left, top, width, height],
      disposal,
    }))).toEqual([
      { rectangle: [0, 0, 3, 2], disposal: 1 },
      { rectangle: [1, 0, 1, 2], disposal: 3 },
      { rectangle: [2, 1, 1, 1], disposal: 1 },
    ]);
    expect(background.frames.every(({ delayCentiseconds }) =>
      delayCentiseconds === 5)).toBe(true);
    expect(previous.frames.every(({ delayCentiseconds }) =>
      delayCentiseconds === 7)).toBe(true);
  });

  it("provides an intentionally out-of-bounds GIF frame", () => {
    const gif = inspectGifFixture("gif/invalid-frame-bounds.gif");
    const invalidFrame = gif.frames[1];

    expect(gif.frames).toHaveLength(2);
    expect([invalidFrame.left, invalidFrame.top, invalidFrame.width, invalidFrame.height])
      .toEqual([2, 1, 2, 1]);
    expect(invalidFrame.left + invalidFrame.width).toBeGreaterThan(gif.width);
  });

  it("provides a two-frame 4x4 PNG sequence with known RGBA pixels", () => {
    const frames = [
      decodeFixturePng("png-sequence/spark-01.png"),
      decodeFixturePng("png-sequence/spark-02.png"),
    ];
    const project = createPngSequenceProject(frames, { frameDurationMs: 100 });

    expect(project.frames).toHaveLength(2);
    expect(project).toMatchObject({ width: 4, height: 4 });
    expect(pixel(frames[0], 1, 1)).toEqual([255, 209, 102, 255]);
    expect(pixel(frames[0], 1, 0)).toEqual([239, 71, 111, 255]);
    expect(pixel(frames[1], 2, 0)).toEqual([17, 138, 178, 255]);
    expect(pixel(frames[1], 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("provides one 8x4 sheet compatible with grid and JSON geometry", () => {
    const sheet = decodeFixturePng("spritesheet/spark-sheet.png");
    const gridProject = createSpritesheetGridProject(sheet, {
      frameWidth: 4,
      frameHeight: 4,
      rows: 1,
      columns: 2,
      frameOrder: "row-major",
    });
    const metadata = parseSpritesheetJsonMetadata(
      readFileSync(join(fixtureDirectory, "spritesheet/spark-sheet.json"), "utf8"),
    );
    const jsonProject = createSpritesheetJsonProject(sheet, metadata);

    expect(gridProject.frames).toHaveLength(2);
    expect(gridProject.layers[0].cels.map((cel) => pixel(cel.imageData, 1, 0))).toEqual([
      [239, 71, 111, 255],
      [0, 0, 0, 0],
    ]);
    expect(jsonProject).toMatchObject({ width: 4, height: 4 });
    expect(jsonProject.frames.map((frame) => frame.durationMs)).toEqual([80, 120]);
    expect(jsonProject.layers[0].cels.map((cel) => pixel(cel.imageData, 2, 0))).toEqual([
      [0, 0, 0, 0],
      [17, 138, 178, 255],
    ]);
  });

  it("provides a trimmed atlas with deterministic placement and timing", () => {
    const sheet = decodeFixturePng("spritesheet/trimmed-atlas.png");
    const metadata = parseSpritesheetJsonMetadata(
      readFileSync(
        join(fixtureDirectory, "spritesheet/trimmed-atlas.json"),
        "utf8",
      ),
    );
    const project = createSpritesheetJsonProject(sheet, metadata);
    const [topRight, leftColumn] = project.layers[0].cels.map(
      ({ imageData }) => imageData,
    );

    expect(sheet).toMatchObject({ width: 3, height: 2 });
    expect(project).toMatchObject({ width: 4, height: 4 });
    expect(project.frames.map(({ durationMs }) => durationMs))
      .toEqual([125, 75]);
    expect(pixel(topRight, 2, 0)).toEqual([255, 209, 102, 255]);
    expect(pixel(topRight, 3, 0)).toEqual([17, 138, 178, 255]);
    expect(pixel(topRight, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(topRight, 2, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(leftColumn, 1, 1)).toEqual([239, 71, 111, 255]);
    expect(pixel(leftColumn, 1, 2)).toEqual([17, 138, 178, 255]);
    expect(pixel(leftColumn, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(leftColumn, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it("provides asymmetric rotated atlas frames with and without trimming", () => {
    const sheet = decodeFixturePng("spritesheet/rotated-atlas.png");
    const metadata = parseSpritesheetJsonMetadata(
      readFileSync(
        join(fixtureDirectory, "spritesheet/rotated-atlas.json"),
        "utf8",
      ),
    );
    const project = createSpritesheetJsonProject(sheet, metadata);
    const [untrimmed, trimmed] = project.layers[0].cels.map(
      ({ imageData }) => imageData,
    );

    expect(sheet).toMatchObject({ width: 3, height: 3 });
    expect(project).toMatchObject({ width: 3, height: 2 });
    expect(project.frames.map(({ durationMs }) => durationMs))
      .toEqual([110, 65]);
    expect([
      pixel(untrimmed, 0, 0),
      pixel(untrimmed, 1, 0),
      pixel(untrimmed, 2, 0),
      pixel(untrimmed, 0, 1),
      pixel(untrimmed, 1, 1),
      pixel(untrimmed, 2, 1),
    ]).toEqual([
      [239, 71, 111, 255],
      [255, 209, 102, 255],
      [0, 0, 0, 0],
      [17, 138, 178, 255],
      [230, 57, 70, 255],
      [42, 157, 143, 255],
    ]);
    expect(pixel(trimmed, 1, 1)).toEqual([69, 123, 157, 255]);
    expect(pixel(trimmed, 2, 1)).toEqual([255, 255, 255, 255]);
    expect(pixel(trimmed, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(trimmed, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it("provides unsupported numeric rotation metadata for rejection coverage", () => {
    const metadata = readFileSync(
      join(
        fixtureDirectory,
        "spritesheet/rotated-atlas-unsupported.json",
      ),
      "utf8",
    );

    expect(() => parseSpritesheetJsonMetadata(metadata)).toThrow(
      "frames[0].rotated must be a boolean; true uses TexturePacker's 90-degree clockwise atlas convention.",
    );
  });

  it("provides invalid trimmed metadata without placement geometry", () => {
    const metadata = readFileSync(
      join(
        fixtureDirectory,
        "spritesheet/trimmed-atlas-missing-placement.json",
      ),
      "utf8",
    );

    expect(() => parseSpritesheetJsonMetadata(metadata)).toThrow(
      "frames[0].spriteSourceSize must be an object when trimmed is true.",
    );
  });

  it("provides a chunked model-version-2 Piskel fixture with three distinct frames", () => {
    const { fixture, layers } = parsePiskelFixture("piskel/multi-frame.piskel");

    expect(fixture).toMatchObject({
      modelVersion: 2,
      piskel: {
        fps: 12,
        height: 2,
        hiddenFrames: [],
        name: "Synthetic motion",
        width: 2,
      },
    });
    expectPiskelFixtureShape(fixture, layers);
    expect(
      Math.max(1, Math.min(65_535, Math.round(1000 / fixture.piskel.fps))),
    ).toBe(83);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      name: "Motion",
      opacity: 1,
      frameCount: 3,
    });
    expect(layers[0].visible).toBeUndefined();
    expect(layers[0].chunks.map(({ layout }) => layout)).toEqual([
      [[0], [1]],
      [[2]],
    ]);
    expect("base64PNG" in layers[0]).toBe(false);

    const chunks = layers[0].chunks.map(decodePiskelChunk);
    expect(chunks.map(({ width, height }) => [width, height])).toEqual([
      [4, 2],
      [2, 2],
    ]);
    expect(pixel(chunks[0], 0, 0)).toEqual([230, 57, 70, 255]);
    expect(pixel(chunks[0], 3, 0)).toEqual([42, 157, 143, 255]);
    expect(pixel(chunks[1], 1, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(chunks[1], 0, 1)).toEqual([69, 123, 157, 255]);
  });

  it("provides ordered Piskel layers with names, opacity, and distinct pixels", () => {
    const { fixture, layers } = parsePiskelFixture("piskel/multi-layer.piskel");

    expect(fixture).toMatchObject({
      modelVersion: 2,
      piskel: { fps: 20, height: 2, name: "Synthetic layers", width: 2 },
    });
    expectPiskelFixtureShape(fixture, layers);
    expect(
      layers.map(({ name, opacity, frameCount }) => ({
        name,
        opacity,
        frameCount,
      })),
    ).toEqual([
        { name: "Background", opacity: 0.5, frameCount: 2 },
        { name: "Accent", opacity: 1, frameCount: 2 },
      ]);
    expect(layers.every(({ visible }) => visible === undefined)).toBe(true);
    expect(layers.map(({ chunks }) => chunks[0].layout)).toEqual([
      [[0], [1]],
      [[0], [1]],
    ]);

    const background = decodePiskelChunk(layers[0].chunks[0]);
    const accent = decodePiskelChunk(layers[1].chunks[0]);
    expect(pixel(background, 0, 0)).toEqual([69, 123, 157, 255]);
    expect(pixel(background, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(accent, 0, 0)).toEqual([230, 57, 70, 255]);
    expect(pixel(accent, 3, 0)).toEqual([42, 157, 143, 255]);
  });

  it("matches deterministic generator output without writing fixtures", () => {
    expect(() =>
      execFileSync(process.execPath, [
        join(fixtureDirectory, "generate.mjs"),
        "--check",
      ]),
    ).not.toThrow();
  });
});
