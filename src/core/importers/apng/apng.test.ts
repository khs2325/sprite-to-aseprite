import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  ApngImportError,
  getApngImportDiagnostic,
  importApngBytes,
  type ApngImportDependencies,
} from ".";

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const dependencies: ApngImportDependencies = {
  inflateZlib: async (bytes) => new Uint8Array(inflateSync(bytes)),
};

type TestChunk = { data: Uint8Array; type: string };

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      new URL(`../../../../tests/fixtures/apng/${name}`, import.meta.url),
    ),
  );
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 8;
  bytes[offset + 1] = value;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseChunks(bytes: Uint8Array): TestChunk[] {
  const chunks: TestChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    chunks.push({
      data: bytes.slice(offset + 8, offset + 8 + length),
      type,
    });
    offset += length + 12;
  }
  return chunks;
}

function encodeChunks(chunks: readonly TestChunk[]): Uint8Array {
  const encoded = chunks.map(({ data, type }) => {
    const chunk = new Uint8Array(data.length + 12);
    writeUint32(chunk, 0, data.length);
    const typeBytes = new TextEncoder().encode(type);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    writeUint32(chunk, data.length + 8, crc32(chunk.subarray(4, data.length + 8)));
    return chunk;
  });
  const result = new Uint8Array(
    PNG_SIGNATURE.length + encoded.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  result.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const chunk of encoded) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function mutateChunk(
  bytes: Uint8Array,
  type: string,
  occurrence: number,
  mutate: (data: Uint8Array) => Uint8Array | void,
): Uint8Array {
  let found = 0;
  const chunks = parseChunks(bytes).map((chunk) => {
    if (chunk.type !== type || found++ !== occurrence) return chunk;
    const replacement = mutate(chunk.data);
    return { ...chunk, data: replacement ?? chunk.data };
  });
  return encodeChunks(chunks);
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

function paeth(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft;
  const distances = [
    Math.abs(prediction - left),
    Math.abs(prediction - up),
    Math.abs(prediction - upperLeft),
  ];
  const minimum = Math.min(...distances);
  return minimum === distances[0] ? left : minimum === distances[1] ? up : upperLeft;
}

function filteredRows(pixels: Uint8Array, filter: number): Uint8Array {
  const rowBytes = 8;
  const rows = new Uint8Array(2 * (rowBytes + 1));
  for (let y = 0; y < 2; y += 1) {
    rows[y * (rowBytes + 1)] = filter;
    for (let x = 0; x < rowBytes; x += 1) {
      const source = y * rowBytes + x;
      const left = x < 4 ? 0 : pixels[source - 4];
      const up = y === 0 ? 0 : pixels[source - rowBytes];
      const upperLeft = x < 4 || y === 0 ? 0 : pixels[source - rowBytes - 4];
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      rows[y * (rowBytes + 1) + x + 1] = (pixels[source] - predictor) & 0xff;
    }
  }
  return rows;
}

function frameControl(sequence: number): Uint8Array {
  const data = new Uint8Array(26);
  writeUint32(data, 0, sequence);
  writeUint32(data, 4, 2);
  writeUint32(data, 8, 2);
  writeUint16(data, 20, 1);
  writeUint16(data, 22, 10);
  return data;
}

function allFilterApng(): { bytes: Uint8Array; pixels: Uint8Array } {
  const pixels = new Uint8Array([
    10, 20, 30, 40, 50, 60, 70, 80,
    90, 100, 110, 120, 130, 140, 150, 160,
  ]);
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, 2);
  writeUint32(ihdr, 4, 2);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const actl = new Uint8Array(8);
  writeUint32(actl, 0, 5);
  const chunks: TestChunk[] = [
    { type: "IHDR", data: ihdr },
    { type: "acTL", data: actl },
  ];
  let sequence = 0;
  for (let filter = 0; filter <= 4; filter += 1) {
    chunks.push({ type: "fcTL", data: frameControl(sequence++) });
    const compressed = new Uint8Array(deflateSync(filteredRows(pixels, filter)));
    if (filter === 0) {
      chunks.push({ type: "IDAT", data: compressed });
    } else {
      const data = new Uint8Array(compressed.length + 4);
      writeUint32(data, 0, sequence++);
      data.set(compressed, 4);
      chunks.push({ type: "fdAT", data });
    }
  }
  chunks.push({ type: "IEND", data: new Uint8Array() });
  return { bytes: encodeChunks(chunks), pixels };
}

describe("APNG importer", () => {
  it("imports fixture timing, offsets, dimensions, and one generated layer", async () => {
    const project = await importApngBytes(
      fixture("timing-offsets.apng"),
      dependencies,
    );

    expect(project).toMatchObject({
      colorMode: "rgba",
      width: 3,
      height: 2,
      frames: [
        { index: 0, durationMs: 1 },
        { index: 1, durationMs: 17 },
        { index: 2, durationMs: 10 },
        { index: 3, durationMs: 65_535 },
      ],
      layers: [
        {
          id: "apng-layer-0",
          name: "APNG frames",
          opacity: 255,
          visible: true,
        },
      ],
    });
    expect(project.layers).toHaveLength(1);
    expect(project.layers[0].cels).toHaveLength(4);
    expect(project.layers[0].cels.every(({ x, y }) => x === 0 && y === 0)).toBe(true);
    expect(pixel(project.layers[0].cels[1].imageData, 0, 0)).toEqual([
      239, 71, 111, 255,
    ]);
  });

  it("composites source and over blending with exact straight-alpha output", async () => {
    const project = await importApngBytes(fixture("blend.apng"), dependencies);
    const snapshots = project.layers[0].cels.map(({ imageData }) => imageData);

    expect(pixel(snapshots[0], 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(snapshots[1], 0, 0)).toEqual([0, 0, 255, 128]);
    expect(pixel(snapshots[2], 1, 0)).toEqual([128, 127, 0, 255]);
  });

  it("applies none, background, and previous disposal after each snapshot", async () => {
    const project = await importApngBytes(fixture("disposal.apng"), dependencies);
    expect(project.layers[0].cels.map(({ imageData }) =>
      [0, 1, 2].map((x) => pixel(imageData, x, 0))))
      .toEqual([
        [[255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255]],
        [[255, 0, 0, 255], [0, 255, 0, 255], [255, 0, 0, 255]],
        [[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 255, 255]],
        [[255, 209, 102, 255], [0, 0, 0, 0], [255, 0, 0, 255]],
      ]);
  });

  it("reverses PNG filters 0 through 4 independently for every frame", async () => {
    const input = allFilterApng();
    const project = await importApngBytes(input.bytes, dependencies);

    expect(project.layers[0].cels).toHaveLength(5);
    for (const cel of project.layers[0].cels) {
      expect([...cel.imageData.data]).toEqual([...input.pixels]);
    }
  });

  it.each([
    ["bad signature", (bytes: Uint8Array) => {
      const copy = bytes.slice();
      copy[0] = 0;
      return copy;
    }, "valid PNG signature"],
    ["bad CRC", (bytes: Uint8Array) => {
      const copy = bytes.slice();
      const idat = parseChunks(copy).findIndex(({ type }) => type === "IDAT");
      let offset = 8;
      for (let index = 0; index <= idat; index += 1) {
        const length = readUint32(copy, offset);
        if (index === idat) copy[offset + 8] ^= 1;
        offset += length + 12;
      }
      return copy;
    }, "chunk IDAT has an invalid CRC"],
    ["sequence gap", (bytes: Uint8Array) => mutateChunk(bytes, "fdAT", 0, (data) => {
      writeUint32(data, 0, readUint32(data, 0) + 1);
    }), "sequence expected 2 but found 3"],
    ["frame bounds", (bytes: Uint8Array) => mutateChunk(bytes, "fcTL", 1, (data) => {
      writeUint32(data, 12, 3);
    }), "frame 2 rectangle exceeds the 3x2 canvas"],
    ["frame count", (bytes: Uint8Array) => mutateChunk(bytes, "acTL", 0, (data) => {
      writeUint32(data, 0, 5);
    }), "declares 5 frames but 4 were found"],
    ["invalid filter", (bytes: Uint8Array) => mutateChunk(bytes, "IDAT", 0, (data) => {
      const rows = new Uint8Array(inflateSync(data));
      rows[0] = 5;
      return new Uint8Array(deflateSync(rows));
    }), "uses invalid PNG filter 5"],
    ["trailing zlib data", (bytes: Uint8Array) => mutateChunk(bytes, "IDAT", 0, (data) => {
      const trailing = new Uint8Array(data.length + 1);
      trailing.set(data);
      return trailing;
    }), "zlib stream contains trailing compressed data"],
  ])("rejects %s deterministically", async (_name, mutate, message) => {
    await expect(
      importApngBytes(mutate(fixture("timing-offsets.apng")), dependencies),
    ).rejects.toThrow(message);
  });

  it("rejects unrecognized chunks instead of guessing their effect", async () => {
    const chunks = parseChunks(fixture("timing-offsets.apng"));
    chunks.splice(-1, 0, {
      type: "tEXt",
      data: new TextEncoder().encode("ignored=no"),
    });

    await expect(importApngBytes(encodeChunks(chunks), dependencies))
      .rejects.toMatchObject({ code: "unsupported-chunk" });
  });

  it("identifies a static PNG without treating it as a one-frame APNG", async () => {
    const chunks = parseChunks(allFilterApng().bytes).filter(
      ({ type }, index) => type === "IHDR" || type === "IDAT" || index === 12,
    );
    const staticPng = encodeChunks([
      chunks.find(({ type }) => type === "IHDR")!,
      chunks.find(({ type }) => type === "IDAT")!,
      { type: "IEND", data: new Uint8Array() },
    ]);

    await expect(importApngBytes(staticPng, dependencies)).rejects.toMatchObject({
      code: "not-animated",
    });
  });

  it("keeps arbitrary inflater failures out of user-facing diagnostics", async () => {
    const privateError = new Error("private decoder detail");
    let thrown: unknown;
    try {
      await importApngBytes(fixture("blend.apng"), {
        inflateZlib: async () => Promise.reject(privateError),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApngImportError);
    expect((thrown as ApngImportError).cause).toBe(privateError);
    expect(getApngImportDiagnostic(thrown)).toBe(
      "Could not decompress APNG frame 1 zlib data.",
    );
    expect(getApngImportDiagnostic(privateError)).toBeNull();
  });
});
