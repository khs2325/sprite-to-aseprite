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
