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
  it("writes the documented RGBA file header fields at their byte offsets", () => {
    const project = createMinimalProject();
    project.width = 0x1234;
    project.height = 0x5678;
    project.frames.push({ index: 1, durationMs: 250 });

    const bytes = exportAseprite(project);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(bytes).toHaveLength(128 + 2 * 16);
    expect(view.getUint32(0, true)).toBe(bytes.length);
    expect(view.getUint16(4, true)).toBe(0xa5e0);
    expect(view.getUint16(6, true)).toBe(2);
    expect(view.getUint16(8, true)).toBe(0x1234);
    expect(view.getUint16(10, true)).toBe(0x5678);
    expect(view.getUint16(12, true)).toBe(32);
    expect(view.getUint32(14, true)).toBe(1);
    expect(view.getUint16(18, true)).toBe(0);
    expect(view.getUint8(28)).toBe(0);
    expect(view.getUint16(32, true)).toBe(0);
    expect(view.getUint8(34)).toBe(1);
    expect(view.getUint8(35)).toBe(1);
    expect(view.getInt16(36, true)).toBe(0);
    expect(view.getInt16(38, true)).toBe(0);
    expect(view.getUint16(40, true)).toBe(0);
    expect(view.getUint16(42, true)).toBe(0);
    expect(bytes.slice(20, 28)).toEqual(new Uint8Array(8));
    expect(bytes.slice(29, 32)).toEqual(new Uint8Array(3));
    expect(bytes.slice(44, 128)).toEqual(new Uint8Array(84));
  });

  it("writes one zero-chunk frame header per frame", () => {
    const project = createMinimalProject();
    project.frames.push({ index: 1, durationMs: 0x1234 });

    const bytes = exportAseprite(project);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (const [offset, duration] of [
      [128, 100],
      [144, 0x1234],
    ] as const) {
      expect(view.getUint32(offset, true)).toBe(16);
      expect(view.getUint16(offset + 4, true)).toBe(0xf1fa);
      expect(view.getUint16(offset + 6, true)).toBe(0);
      expect(view.getUint16(offset + 8, true)).toBe(duration);
      expect(bytes.slice(offset + 10, offset + 12)).toEqual(new Uint8Array(2));
      expect(view.getUint32(offset + 12, true)).toBe(0);
    }
  });

  it.each([
    ["width", 0],
    ["width", 1.5],
    ["width", 0x10000],
    ["height", -1],
    ["height", 0x10000],
  ] as const)("rejects an unrepresentable %s of %s", (field, value) => {
    const project = createMinimalProject();
    project[field] = value;

    expect(() => exportAseprite(project)).toThrow(RangeError);
  });

  it("rejects frame counts outside the file header range", () => {
    const emptyProject = createMinimalProject();
    emptyProject.frames = [];

    const oversizedProject = createMinimalProject();
    oversizedProject.frames = new Array(0x10000).fill(
      oversizedProject.frames[0],
    );

    expect(() => exportAseprite(emptyProject)).toThrow(RangeError);
    expect(() => exportAseprite(oversizedProject)).toThrow(RangeError);
  });

  it("rejects frame durations that cannot be written as a WORD", () => {
    const project = createMinimalProject();
    project.frames[0].durationMs = 0x10000;

    expect(() => exportAseprite(project)).toThrow(RangeError);
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
