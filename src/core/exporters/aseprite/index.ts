import type { SpriteProject } from "../../SpriteProject";

import { BinaryWriter } from "./binaryWriter";

export { BinaryWriter } from "./binaryWriter";

const FILE_HEADER_SIZE = 128;
const FRAME_HEADER_SIZE = 16;
const FILE_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;
const RGBA_COLOR_DEPTH = 32;
const LAYER_OPACITY_IS_VALID = 1;
const UINT16_MAX = 0xffff;

export class UnsupportedAsepriteFeatureError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(`Aseprite export does not support ${feature}.`);
    this.name = "UnsupportedAsepriteFeatureError";
    this.feature = feature;
  }
}

function assertPositiveUint16(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1 || value > UINT16_MAX) {
    throw new RangeError(
      `${field} must be an integer from 1 to ${UINT16_MAX}.`,
    );
  }
}

function validateHeaderFields(project: SpriteProject): void {
  assertPositiveUint16(project.width, "Project width");
  assertPositiveUint16(project.height, "Project height");
  assertPositiveUint16(project.frames.length, "Project frame count");

  project.frames.forEach((frame, index) => {
    assertPositiveUint16(frame.durationMs, `Frame ${index} duration`);
  });
}

function writeFileHeader(
  writer: BinaryWriter,
  project: SpriteProject,
  fileSize: number,
): void {
  writer.writeUint32LE(fileSize);
  writer.writeUint16LE(FILE_MAGIC);
  writer.writeUint16LE(project.frames.length);
  writer.writeUint16LE(project.width);
  writer.writeUint16LE(project.height);
  writer.writeUint16LE(RGBA_COLOR_DEPTH);
  writer.writeUint32LE(LAYER_OPACITY_IS_VALID);
  writer.writeUint16LE(0); // Deprecated frame speed.
  writer.writeUint32LE(0);
  writer.writeUint32LE(0);
  writer.writeUint8(0); // Transparent palette index; unused for RGBA.
  writer.writeBytes(new Uint8Array(3));
  writer.writeUint16LE(0); // Number of colors; unused for RGBA.
  writer.writeUint8(1);
  writer.writeUint8(1);
  writer.writeUint16LE(0); // Grid X position.
  writer.writeUint16LE(0); // Grid Y position.
  writer.writeUint16LE(0); // No grid width.
  writer.writeUint16LE(0); // No grid height.
  writer.writeBytes(new Uint8Array(84));
}

function writeFrameHeader(writer: BinaryWriter, durationMs: number): void {
  writer.writeUint32LE(FRAME_HEADER_SIZE);
  writer.writeUint16LE(FRAME_MAGIC);
  writer.writeUint16LE(0); // Old chunk count.
  writer.writeUint16LE(durationMs);
  writer.writeUint16LE(0);
  writer.writeUint32LE(0); // New chunk count.
}

export function exportAseprite(project: SpriteProject): Uint8Array {
  if (project.colorMode !== "rgba") {
    throw new UnsupportedAsepriteFeatureError(
      `the ${String(project.colorMode)} color mode`,
    );
  }

  validateHeaderFields(project);

  const writer = new BinaryWriter();
  const fileSize = FILE_HEADER_SIZE + FRAME_HEADER_SIZE * project.frames.length;

  writeFileHeader(writer, project, fileSize);
  project.frames.forEach((frame) => {
    writeFrameHeader(writer, frame.durationMs);
  });

  return writer.toUint8Array();
}
