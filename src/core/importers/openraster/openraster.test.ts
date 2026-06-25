import { readFileSync } from "node:fs";
import { deflateRawSync, inflateRawSync, inflateSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import {
  getOpenRasterImportDiagnostic,
  importOpenRaster,
  importOpenRasterBytes,
  OpenRasterImportError,
  type OpenRasterImportErrorCode,
} from ".";

const pngSignature = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type ZipTestEntry = {
  compressionMethod?: 0 | 8;
  content: string | Uint8Array;
  name: string;
};

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      new URL(`../../../../tests/fixtures/openraster/${name}.ora`, import.meta.url),
    ),
  );
}

function pngFixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      new URL(`../../../../tests/fixtures/png-sequence/${name}.png`, import.meta.url),
    ),
  );
}

function createFile(name: string, bytes: Uint8Array): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Blob([buffer], { type: "image/openraster" }), {
    lastModified: 0,
    name,
  }) as File;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
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

function uint16LE(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function uint32LE(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function zipLocalHeader(entry: {
  compressedSize: number;
  compressionMethod: number;
  crc: number;
  name: Buffer;
  uncompressedSize: number;
}): Buffer {
  return Buffer.concat([
    uint32LE(0x04034b50),
    uint16LE(20),
    uint16LE(0x0800),
    uint16LE(entry.compressionMethod),
    uint16LE(0),
    uint16LE(0),
    uint32LE(entry.crc),
    uint32LE(entry.compressedSize),
    uint32LE(entry.uncompressedSize),
    uint16LE(entry.name.length),
    uint16LE(0),
  ]);
}

function zipCentralDirectoryHeader(entry: {
  compressedSize: number;
  compressionMethod: number;
  crc: number;
  localHeaderOffset: number;
  name: Buffer;
  uncompressedSize: number;
}): Buffer {
  return Buffer.concat([
    uint32LE(0x02014b50),
    uint16LE(20),
    uint16LE(20),
    uint16LE(0x0800),
    uint16LE(entry.compressionMethod),
    uint16LE(0),
    uint16LE(0),
    uint32LE(entry.crc),
    uint32LE(entry.compressedSize),
    uint32LE(entry.uncompressedSize),
    uint16LE(entry.name.length),
    uint16LE(0),
    uint16LE(0),
    uint16LE(0),
    uint16LE(0),
    uint32LE(0),
    uint32LE(entry.localHeaderOffset),
  ]);
}

function encodeZip(entries: readonly ZipTestEntry[]): Uint8Array {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const source =
      typeof entry.content === "string"
        ? Buffer.from(entry.content, "utf8")
        : Buffer.from(entry.content);
    const compressionMethod = entry.compressionMethod ?? 8;
    const compressed =
      compressionMethod === 0 ? source : deflateRawSync(source, { level: 9 });
    const metadata = {
      compressedSize: compressed.length,
      compressionMethod,
      crc: crc32(source),
      localHeaderOffset,
      name,
      uncompressedSize: source.length,
    };
    const localHeader = zipLocalHeader(metadata);
    localRecords.push(localHeader, name, compressed);
    centralRecords.push(zipCentralDirectoryHeader(metadata), name);
    localHeaderOffset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.concat([
    uint32LE(0x06054b50),
    uint16LE(0),
    uint16LE(0),
    uint16LE(entries.length),
    uint16LE(entries.length),
    uint32LE(centralDirectory.length),
    uint32LE(localHeaderOffset),
    uint16LE(0),
  ]);
  return new Uint8Array(Buffer.concat([...localRecords, centralDirectory, end]));
}

function oraWithStack(
  stackXml: string,
  extraEntries: readonly ZipTestEntry[] = [],
): Uint8Array {
  return encodeZip([
    {
      name: "mimetype",
      content: "image/openraster",
      compressionMethod: 0,
    },
    { name: "stack.xml", content: stackXml },
    ...extraEntries,
  ]);
}

async function inflateRaw(compressed: Uint8Array, maximumOutputBytes: number): Promise<Uint8Array> {
  const output = new Uint8Array(inflateRawSync(compressed));
  if (output.length > maximumOutputBytes) {
    throw new Error("inflated beyond requested maximum");
  }
  return output;
}

function decodeFixturePng(bytes: Uint8Array): ImageData {
  expect(bytes.subarray(0, pngSignature.length)).toEqual(pngSignature);

  let offset = pngSignature.length;
  let width = 0;
  let height = 0;
  const compressed: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const rows = inflateSync(Buffer.concat(compressed.map((part) => Buffer.from(part))));
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

function dependencies() {
  return {
    decodePng: vi.fn<(bytes: Uint8Array) => Promise<ImageData>>(async (bytes) =>
      decodeFixturePng(bytes),
    ),
    inflateRaw,
  };
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [...image.data.slice(offset, offset + 4)];
}

async function expectOpenRasterError(
  operation: Promise<unknown>,
  code: OpenRasterImportErrorCode,
  message: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(OpenRasterImportError);
    expect(error).toMatchObject({ code });
    expect(getOpenRasterImportDiagnostic(error)).toContain(message);
    return;
  }
  throw new Error(`Expected OpenRaster import to fail with ${code}.`);
}

describe("OpenRaster importer", () => {
  it("imports the documented two-layer fixture into one SpriteProject frame", async () => {
    const deps = dependencies();
    const project = await importOpenRasterBytes(fixture("two-layers"), deps);

    expect(project).toMatchObject({
      colorMode: "rgba",
      width: 4,
      height: 3,
      frames: [{ index: 0, durationMs: 100 }],
      layers: [
        {
          id: "openraster-layer-0",
          name: "Top hidden half",
          opacity: 128,
          visible: false,
          cels: [{ frameIndex: 0, x: 1, y: -1 }],
        },
        {
          id: "openraster-layer-1",
          name: "Base visible",
          opacity: 255,
          visible: true,
          cels: [{ frameIndex: 0, x: 0, y: 1 }],
        },
      ],
    });
    expect(deps.decodePng).toHaveBeenCalledTimes(2);
    expect(project.layers.map((layer) => layer.cels[0].imageData.width)).toEqual([2, 2]);
    expect(pixel(project.layers[0].cels[0].imageData, 1, 0)).toEqual([
      255, 209, 102, 255,
    ]);
    expect(pixel(project.layers[0].cels[0].imageData, 0, 1)).toEqual([
      239, 71, 111, 255,
    ]);
    expect(pixel(project.layers[1].cels[0].imageData, 0, 0)).toEqual([
      239, 71, 111, 255,
    ]);
    expect(pixel(project.layers[1].cels[0].imageData, 1, 1)).toEqual([
      255, 209, 102, 255,
    ]);
  });

  it("uses deterministic defaults for optional layer metadata", async () => {
    const project = await importOpenRasterBytes(
      oraWithStack(
        `<image version="0.0.6" w="4" h="4"><stack><layer src="data/layer.png" /></stack></image>`,
        [{ name: "data/layer.png", content: pngFixture("spark-01") }],
      ),
      dependencies(),
    );

    expect(project.layers).toMatchObject([
      {
        id: "openraster-layer-0",
        name: "Layer 1",
        opacity: 255,
        visible: true,
        cels: [{ frameIndex: 0, x: 0, y: 0 }],
      },
    ]);
  });

  it("reads a local File without changing the browser-only import boundary", async () => {
    const project = await importOpenRaster(
      createFile("two-layers.ora", fixture("two-layers")),
      dependencies(),
    );

    expect(project).toMatchObject({ width: 4, height: 3 });
  });
});

describe("OpenRaster validation", () => {
  it.each([
    [
      "unsupported-blend-mode" as const,
      "unsupported-feature" as const,
      "unsupported blend mode",
    ],
    [
      "missing-layer-data" as const,
      "missing-entry" as const,
      "data/top-hidden.png",
    ],
    ["malformed-stack" as const, "invalid-stack" as const, "malformed XML"],
  ])("rejects fixture %s deterministically", async (name, code, message) => {
    await expectOpenRasterError(
      importOpenRasterBytes(fixture(name), dependencies()),
      code,
      message,
    );
  });

  it.each([
    [
      "unsafe layer src",
      `<image w="1" h="1"><stack><layer src="../pixels.png" /></stack></image>`,
      "unsafe-path" as const,
      "normalized relative archive path",
    ],
    [
      "nested stack",
      `<image w="1" h="1"><stack><stack><layer src="data/layer.png" /></stack></stack></image>`,
      "unsupported-feature" as const,
      "nested stacks",
    ],
    [
      "layer mask",
      `<image w="1" h="1"><stack><layer src="data/layer.png"><mask /></layer></stack></image>`,
      "unsupported-feature" as const,
      "masks, effects",
    ],
    [
      "animation metadata",
      `<image w="1" h="1"><stack><layer src="data/layer.png" /></stack><animation /></image>`,
      "unsupported-feature" as const,
      "animation metadata",
    ],
    [
      "invalid canvas width",
      `<image w="0" h="1"><stack><layer src="data/layer.png" /></stack></image>`,
      "allocation-limit" as const,
      "1 through",
    ],
    [
      "unsafe offset integer",
      `<image w="1" h="1"><stack><layer src="data/layer.png" x="32768" /></stack></image>`,
      "invalid-stack" as const,
      "integer from -32768 through 32767",
    ],
  ])("rejects %s before PNG decode", async (_name, stackXml, code, message) => {
    const deps = dependencies();

    await expectOpenRasterError(
      importOpenRasterBytes(oraWithStack(stackXml), deps),
      code,
      message,
    );
    expect(deps.decodePng).not.toHaveBeenCalled();
  });

  it("rejects invalid mimetype and unsafe ZIP entry paths", async () => {
    await expectOpenRasterError(
      importOpenRasterBytes(
        encodeZip([
          { name: "mimetype", content: "image/openraster\n", compressionMethod: 0 },
          { name: "stack.xml", content: `<image w="1" h="1"><stack /></image>` },
        ]),
        dependencies(),
      ),
      "invalid-mimetype",
      "image/openraster",
    );

    await expectOpenRasterError(
      importOpenRasterBytes(
        encodeZip([
          { name: "mimetype", content: "image/openraster", compressionMethod: 0 },
          { name: "../evil.txt", content: "not used" },
          { name: "stack.xml", content: `<image w="1" h="1"><stack /></image>` },
        ]),
        dependencies(),
      ),
      "unsafe-path",
      "safe relative archive path",
    );
  });

  it("keeps arbitrary decoder failures out of user-facing diagnostics", async () => {
    const privateError = new Error("private PNG decoder detail");
    let thrown: unknown;
    try {
      await importOpenRasterBytes(fixture("two-layers"), {
        inflateRaw,
        decodePng: async () => Promise.reject(privateError),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OpenRasterImportError);
    expect((thrown as OpenRasterImportError).cause).toBe(privateError);
    expect(getOpenRasterImportDiagnostic(thrown)).toBe(
      "Could not decode PNG data for OpenRaster layer 1 (data/top-hidden.png).",
    );
    expect(getOpenRasterImportDiagnostic(privateError)).toBeNull();
  });
});
