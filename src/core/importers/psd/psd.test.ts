import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  getPsdParserDiagnostic,
  parsePsdBytes,
  parsePsdFile,
  PsdParserAdapterError,
  type PsdParserAdapterErrorCode,
  type PsdReadOptions,
} from ".";

type FixtureSet = {
  fixtures: PsdFixture[];
};

type PsdFixture = {
  header: {
    bitsPerChannel: number;
    channels: number;
    colorMode: number;
    height: number;
    width: number;
  };
  layers: PsdFixtureLayer[];
  name: string;
};

type PsdFixtureLayer = {
  blendMode?: string;
  bottom: number;
  children?: PsdFixtureLayer[];
  hidden?: boolean;
  imageData?: {
    height: number;
    rgba: number[];
    width: number;
  };
  left: number;
  name: string;
  opacity?: number;
  right: number;
  text?: { text: string };
  top: number;
};

const fixtures = JSON.parse(
  readFileSync(
    new URL("../../../../tests/fixtures/psd/minimal-psd-fixtures.json", import.meta.url),
    "utf8",
  ),
) as FixtureSet;

function fixture(name: string): PsdFixture {
  const found = fixtures.fixtures.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`Missing PSD fixture ${name}.`);
  }
  return found;
}

function uint16BE(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  return bytes;
}

function uint32BE(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function psdHeaderBytes(
  header: PsdFixture["header"],
  overrides: Partial<PsdFixture["header"]> = {},
): Uint8Array {
  const values = { ...header, ...overrides };
  return new Uint8Array(Buffer.concat([
    Buffer.from("8BPS", "ascii"),
    uint16BE(1),
    Buffer.alloc(6),
    uint16BE(values.channels),
    uint32BE(values.height),
    uint32BE(values.width),
    uint16BE(values.bitsPerChannel),
    uint16BE(values.colorMode),
    uint32BE(0),
    uint32BE(0),
    uint32BE(0),
    uint16BE(0),
  ]));
}

function createImageDataFixture(
  imageData: PsdFixtureLayer["imageData"],
): ImageData | undefined {
  if (imageData === undefined) return undefined;
  return {
    colorSpace: "srgb",
    data: new Uint8ClampedArray(imageData.rgba),
    height: imageData.height,
    width: imageData.width,
  };
}

function parserLayerFromFixture(layer: PsdFixtureLayer): Record<string, unknown> {
  return {
    blendMode: layer.blendMode,
    bottom: layer.bottom,
    children: layer.children?.map(parserLayerFromFixture),
    hidden: layer.hidden,
    imageData: createImageDataFixture(layer.imageData),
    left: layer.left,
    name: layer.name,
    opacity: layer.opacity,
    right: layer.right,
    text: layer.text,
    top: layer.top,
  };
}

function parserDocumentFromFixture(psd: PsdFixture): Record<string, unknown> {
  return {
    bitsPerChannel: psd.header.bitsPerChannel,
    channels: psd.header.channels,
    children: psd.layers.map(parserLayerFromFixture),
    colorMode: psd.header.colorMode,
    height: psd.header.height,
    width: psd.header.width,
  };
}

function createFile(name: string, bytes: Uint8Array): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return Object.assign(new Blob([buffer], { type: "image/vnd.adobe.photoshop" }), {
    lastModified: 0,
    name,
  }) as File;
}

async function expectPsdError(
  operation: Promise<unknown>,
  code: PsdParserAdapterErrorCode,
  message: string,
): Promise<PsdParserAdapterError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PsdParserAdapterError);
    expect(error).toMatchObject({ code });
    expect(getPsdParserDiagnostic(error)).toContain(message);
    return error as PsdParserAdapterError;
  }
  throw new Error(`Expected PSD parser adapter to fail with ${code}.`);
}

describe("PSD parser adapter", () => {
  it("parses a synthetic RGB8 raster fixture through the injected parser without network calls", async () => {
    const psd = fixture("rgb8-two-raster-layers");
    const bytes = psdHeaderBytes(psd.header);
    const readPsd = vi.fn((input: Uint8Array, options: PsdReadOptions) => {
      expect(input).toBe(bytes);
      expect(options).toEqual({
        skipCompositeImageData: true,
        skipLinkedFilesData: true,
        skipThumbnail: true,
        throwForMissingFeatures: true,
        useImageData: true,
      });
      return parserDocumentFromFixture(psd);
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const parsed = await parsePsdBytes(bytes, { parser: { readPsd } });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(readPsd).toHaveBeenCalledTimes(1);
    expect(parsed).toMatchObject({
      bitsPerChannel: 8,
      channels: 4,
      colorMode: 3,
      frames: [{ index: 0, durationMs: 100 }],
      height: 3,
      width: 4,
      layers: [
        {
          blendMode: "normal",
          bottom: 1,
          hasImageData: true,
          left: 1,
          name: "Top hidden half",
          opacity: 128,
          right: 3,
          top: -1,
          visible: false,
        },
        {
          blendMode: "normal",
          bottom: 3,
          hasImageData: true,
          left: 0,
          name: "Base visible",
          opacity: 255,
          right: 2,
          top: 1,
          visible: true,
        },
      ],
    });
    expect([...parsed.layers[0].imageData!.data]).toEqual(
      psd.layers[0].imageData!.rgba,
    );
  });

  it("reads a browser File without changing the local-only import boundary", async () => {
    const psd = fixture("rgb8-two-raster-layers");
    const bytes = psdHeaderBytes(psd.header);
    const parsed = await parsePsdFile(createFile(`${psd.name}.psd`, bytes), {
      parser: {
        readPsd: () => parserDocumentFromFixture(psd),
      },
    });

    expect(parsed).toMatchObject({ width: 4, height: 3 });
  });

  it("keeps group and text parser metadata visible without converting it", async () => {
    const psd = fixture("rgb8-group-and-text-metadata");
    const parsed = await parsePsdBytes(psdHeaderBytes(psd.header), {
      parser: {
        readPsd: () => parserDocumentFromFixture(psd),
      },
    });

    expect(parsed.layers).toMatchObject([
      {
        children: [
          {
            hasText: true,
            name: "Caption",
          },
        ],
        hasImageData: false,
        name: "Folder",
      },
    ]);
  });
});

describe("PSD parser adapter diagnostics", () => {
  it("normalizes parser failures without exposing parser details", async () => {
    const psd = fixture("rgb8-two-raster-layers");
    const privateError = new Error("C:\\Users\\private\\sprite.psd raw channel bytes");
    const error = await expectPsdError(
      parsePsdBytes(psdHeaderBytes(psd.header), {
        parser: {
          readPsd: () => {
            throw privateError;
          },
        },
      }),
      "parser-error",
      "Could not parse the selected PSD file.",
    );

    expect(error.cause).toBe(privateError);
    expect(getPsdParserDiagnostic(error)).not.toContain("private");
    expect(getPsdParserDiagnostic(privateError)).toBeNull();
  });

  it("normalizes parser loader failures before exposing diagnostics", async () => {
    const psd = fixture("rgb8-two-raster-layers");
    const privateError = new Error("registry or local module path detail");
    const error = await expectPsdError(
      parsePsdBytes(psdHeaderBytes(psd.header), {
        loadParser: async () => Promise.reject(privateError),
      }),
      "parser-unavailable",
      "The PSD parser dependency is not available.",
    );

    expect(error.cause).toBe(privateError);
    expect(getPsdParserDiagnostic(error)).not.toContain("registry");
  });

  it("rejects unsupported headers before invoking the parser", async () => {
    const psd = fixture("rgb8-two-raster-layers");
    const readPsd = vi.fn();

    await expectPsdError(
      parsePsdBytes(psdHeaderBytes(psd.header, { colorMode: 4 }), {
        parser: { readPsd },
      }),
      "unsupported-feature",
      "color mode must be RGB",
    );
    await expectPsdError(
      parsePsdBytes(psdHeaderBytes(psd.header, { bitsPerChannel: 16 }), {
        parser: { readPsd },
      }),
      "unsupported-feature",
      "8 bits per channel",
    );

    expect(readPsd).not.toHaveBeenCalled();
  });

  it("rejects invalid parser output instead of passing through unsafe data", async () => {
    const psd = fixture("rgb8-two-raster-layers");

    await expectPsdError(
      parsePsdBytes(psdHeaderBytes(psd.header), {
        parser: {
          readPsd: () => ({
            ...parserDocumentFromFixture(psd),
            children: [
              {
                ...parserLayerFromFixture(psd.layers[0]),
                imageData: {
                  data: new Uint8ClampedArray([1, 2, 3]),
                  height: 1,
                  width: 1,
                },
              },
            ],
          }),
        },
      }),
      "invalid-parser-output",
      "must contain RGBA ImageData",
    );
  });
});
