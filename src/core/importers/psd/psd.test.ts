import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  getPsdParserDiagnostic,
  importPsd,
  importPsdBytes,
  parsePsdBytes,
  parsePsdFile,
  PsdParserAdapterError,
  type PsdParserAdapterErrorCode,
  type PsdReadOptions,
} from ".";

type FixtureSet = {
  fixtures: PsdFixture[];
  unsupportedMetadataFixtures: UnsupportedMetadataFixture[];
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

type UnsupportedMetadataFixture = {
  expectedCode: PsdParserAdapterErrorCode;
  expectedDiagnostic: string;
  header: PsdFixture["header"];
  layerCount: number;
  name: string;
  version?: number;
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

function visibleRasterFixture(): PsdFixture {
  const psd = fixture("rgb8-two-raster-layers");
  return {
    ...psd,
    name: "rgb8-visible-raster-layers",
    layers: psd.layers.map((layer, index) => ({
      ...layer,
      hidden: false,
      name: index === 0 ? "Top visible half" : layer.name,
    })),
  };
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

function int16BE(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeInt16BE(value);
  return bytes;
}

function psdLayerMaskSectionBytes(layerCount: number): Buffer {
  const layerInfoSection = layerCount === 0
    ? Buffer.alloc(0)
    : Buffer.concat([int16BE(layerCount)]);
  return Buffer.concat([
    uint32BE(layerInfoSection.byteLength),
    layerInfoSection,
  ]);
}

function psdHeaderBytes(
  header: PsdFixture["header"],
  overrides: Partial<PsdFixture["header"]> = {},
  options: { layerCount?: number; version?: number } = {},
): Uint8Array {
  const values = { ...header, ...overrides };
  const layerMaskSection = psdLayerMaskSectionBytes(options.layerCount ?? 1);
  return new Uint8Array(Buffer.concat([
    Buffer.from("8BPS", "ascii"),
    uint16BE(options.version ?? 1),
    Buffer.alloc(6),
    uint16BE(values.channels),
    uint32BE(values.height),
    uint32BE(values.width),
    uint16BE(values.bitsPerChannel),
    uint16BE(values.colorMode),
    uint32BE(0),
    uint32BE(0),
    uint32BE(layerMaskSection.byteLength),
    layerMaskSection,
    uint16BE(0),
  ]));
}

function countFixtureLayers(layers: PsdFixtureLayer[]): number {
  return layers.reduce(
    (count, layer) => count + 1 + countFixtureLayers(layer.children ?? []),
    0,
  );
}

function psdFixtureBytes(
  psd: PsdFixture,
  options: { header?: Partial<PsdFixture["header"]>; layerCount?: number; version?: number } = {},
): Uint8Array {
  return psdHeaderBytes(psd.header, options.header, {
    layerCount: options.layerCount ?? countFixtureLayers(psd.layers),
    version: options.version,
  });
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
    const bytes = psdFixtureBytes(psd);
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
    const bytes = psdFixtureBytes(psd);
    const parsed = await parsePsdFile(createFile(`${psd.name}.psd`, bytes), {
      parser: {
        readPsd: () => parserDocumentFromFixture(psd),
      },
    });

    expect(parsed).toMatchObject({ width: 4, height: 3 });
  });

  it("normalizes group and text parser metadata for later diagnostics", async () => {
    const psd = fixture("rgb8-group-and-text-metadata");
    const parsed = await parsePsdBytes(psdFixtureBytes(psd), {
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

describe("PSD importer", () => {
  it("converts visible supported raster layers into the internal sprite model", async () => {
    const psd = visibleRasterFixture();
    const project = await importPsdBytes(psdFixtureBytes(psd), {
      parser: {
        readPsd: () => parserDocumentFromFixture(psd),
      },
    });

    expect(project).toMatchObject({
      width: 4,
      height: 3,
      colorMode: "rgba",
      frames: [{ index: 0, durationMs: 100 }],
      layers: [
        {
          id: "psd-layer-0",
          name: "Top visible half",
          visible: true,
          opacity: 128,
          cels: [
            {
              frameIndex: 0,
              x: 1,
              y: -1,
              imageData: {
                width: 2,
                height: 2,
              },
            },
          ],
        },
        {
          id: "psd-layer-1",
          name: "Base visible",
          visible: true,
          opacity: 255,
          cels: [
            {
              frameIndex: 0,
              x: 0,
              y: 1,
              imageData: {
                width: 2,
                height: 2,
              },
            },
          ],
        },
      ],
    });
    expect([...project.layers[0].cels[0].imageData.data]).toEqual(
      psd.layers[0].imageData!.rgba,
    );
    expect([...project.layers[1].cels[0].imageData.data]).toEqual(
      psd.layers[1].imageData!.rgba,
    );
  });

  it("omits hidden raster layers instead of presenting them as preserved", async () => {
    const psd = fixture("rgb8-two-raster-layers");
    const project = await importPsd(createFile(`${psd.name}.psd`, psdFixtureBytes(psd)), {
      parser: {
        readPsd: () => parserDocumentFromFixture(psd),
      },
    });

    expect(project.frames).toEqual([{ index: 0, durationMs: 100 }]);
    expect(project.layers).toHaveLength(1);
    expect(project.layers[0]).toMatchObject({
      id: "psd-layer-1",
      name: "Base visible",
      visible: true,
      opacity: 255,
      cels: [{ frameIndex: 0, x: 0, y: 1 }],
    });
  });

  it("rejects visible groups instead of preserving unsupported layer structure", async () => {
    const psd = fixture("rgb8-group-and-text-metadata");

    await expectPsdError(
      importPsdBytes(psdFixtureBytes(psd), {
        parser: {
          readPsd: () => parserDocumentFromFixture(psd),
        },
      }),
      "unsupported-feature",
      "PSD groups are not supported",
    );
  });

  it("rejects visible text layers instead of using parser preview pixels", async () => {
    const psd = visibleRasterFixture();
    const textLayer = {
      ...parserLayerFromFixture(psd.layers[0]),
      name: "Caption",
      text: { text: "Synthetic" },
    };

    await expectPsdError(
      importPsdBytes(psdFixtureBytes(psd, { layerCount: 1 }), {
        parser: {
          readPsd: () => ({
            ...parserDocumentFromFixture(psd),
            children: [textLayer],
          }),
        },
      }),
      "unsupported-feature",
      "PSD text layers are not supported",
    );
  });

  it("rejects raster layers whose decoded pixels do not match layer bounds", async () => {
    const psd = visibleRasterFixture();
    const mismatchedLayer = {
      ...parserLayerFromFixture(psd.layers[0]),
      imageData: {
        colorSpace: "srgb",
        data: new Uint8ClampedArray(2 * 2 * 4),
        height: 2,
        width: 2,
      },
      right: 4,
    };

    await expectPsdError(
      importPsdBytes(psdFixtureBytes(psd, { layerCount: 1 }), {
        parser: {
          readPsd: () => ({
            ...parserDocumentFromFixture(psd),
            children: [mismatchedLayer],
          }),
        },
      }),
      "invalid-parser-output",
      "ImageData dimensions must match raster bounds",
    );
  });
});

describe("PSD parser adapter diagnostics", () => {
  it("normalizes parser failures without exposing parser details", async () => {
    const psd = fixture("rgb8-two-raster-layers");
    const privateError = new Error("C:\\Users\\private\\sprite.psd raw channel bytes");
    const error = await expectPsdError(
      parsePsdBytes(psdFixtureBytes(psd), {
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
      parsePsdBytes(psdFixtureBytes(psd), {
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
      parsePsdBytes(psdFixtureBytes(psd, { header: { colorMode: 4 } }), {
        parser: { readPsd },
      }),
      "unsupported-feature",
      "color mode must be RGB",
    );
    await expectPsdError(
      parsePsdBytes(psdFixtureBytes(psd, { header: { bitsPerChannel: 16 } }), {
        parser: { readPsd },
      }),
      "unsupported-feature",
      "8 bits per channel",
    );

    expect(readPsd).not.toHaveBeenCalled();
  });

  it.each(fixtures.unsupportedMetadataFixtures)(
    "rejects unsupported metadata fixture $name before invoking the parser",
    async (metadata) => {
      const readPsd = vi.fn();

      await expectPsdError(
        parsePsdBytes(psdHeaderBytes(metadata.header, {}, {
          layerCount: metadata.layerCount,
          version: metadata.version,
        }), {
          parser: { readPsd },
        }),
        metadata.expectedCode,
        metadata.expectedDiagnostic,
      );

      expect(readPsd).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid parser output instead of passing through unsafe data", async () => {
    const psd = fixture("rgb8-two-raster-layers");

    await expectPsdError(
      parsePsdBytes(psdFixtureBytes(psd, { layerCount: 1 }), {
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
