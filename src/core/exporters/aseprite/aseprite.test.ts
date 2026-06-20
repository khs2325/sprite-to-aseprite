import { describe, expect, it } from "vitest";

import type { SpriteProject } from "../../SpriteProject";
import {
  BinaryWriter,
  exportAseprite,
  UnsupportedAsepriteFeatureError,
} from ".";

function createMinimalProject(): SpriteProject {
  return {
    width: 1,
    height: 1,
    colorMode: "rgba",
    frames: [{ index: 0, durationMs: 100 }],
    layers: [
      {
        id: "main",
        name: "Main",
        visible: true,
        opacity: 255,
        cels: [],
      },
    ],
  };
}

describe("BinaryWriter", () => {
  it("writes explicit unsigned values in little-endian order", () => {
    const writer = new BinaryWriter();

    writer.writeUint8(0x12);
    writer.writeUint16LE(0x3456);
    writer.writeUint32LE(0x789abcde);
    writer.writeBytes(new Uint8Array([0xf0, 0xff]));

    expect(writer.length).toBe(9);
    expect(writer.toUint8Array()).toEqual(
      new Uint8Array([0x12, 0x56, 0x34, 0xde, 0xbc, 0x9a, 0x78, 0xf0, 0xff]),
    );
  });

  it("rejects values that cannot be represented by the requested type", () => {
    const writer = new BinaryWriter();

    expect(() => writer.writeUint8(256)).toThrow(RangeError);
    expect(() => writer.writeUint16LE(-1)).toThrow(RangeError);
    expect(() => writer.writeUint32LE(1.5)).toThrow(RangeError);
    expect(writer.length).toBe(0);
  });
});

describe("exportAseprite", () => {
  it("returns deterministic empty binary output for the writer skeleton", () => {
    const project = createMinimalProject();

    const first = exportAseprite(project);
    const second = exportAseprite(project);

    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toEqual(new Uint8Array());
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("rejects unsupported color modes with a typed error", () => {
    const project = {
      ...createMinimalProject(),
      colorMode: "indexed",
    } as unknown as SpriteProject;

    expect(() => exportAseprite(project)).toThrow(
      UnsupportedAsepriteFeatureError,
    );

    try {
      exportAseprite(project);
    } catch (error) {
      expect(error).toMatchObject({
        feature: "the indexed color mode",
        name: "UnsupportedAsepriteFeatureError",
      });
    }
  });
});
