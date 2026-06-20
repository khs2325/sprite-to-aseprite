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

function decodeFixturePng(relativePath: string): ImageData {
  const png = readFileSync(join(fixtureDirectory, relativePath));
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
});
