import type { SpriteProject } from "../../SpriteProject";

import { BinaryWriter } from "./binaryWriter";

export { BinaryWriter } from "./binaryWriter";

export class UnsupportedAsepriteFeatureError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(`Aseprite export does not support ${feature}.`);
    this.name = "UnsupportedAsepriteFeatureError";
    this.feature = feature;
  }
}

export function exportAseprite(project: SpriteProject): Uint8Array {
  if (project.colorMode !== "rgba") {
    throw new UnsupportedAsepriteFeatureError(
      `the ${String(project.colorMode)} color mode`,
    );
  }

  const writer = new BinaryWriter();

  // File headers and chunks are intentionally added by subsequent writer tasks.
  return writer.toUint8Array();
}
