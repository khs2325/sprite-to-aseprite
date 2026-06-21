import { describe, expect, it } from "vitest";

import {
  LARGE_FILE_WARNING,
  LARGE_SOURCE_SIZE_BYTES,
  LONG_SEQUENCE_FILE_COUNT,
  getLargeFileWarning,
  renderLargeFileWarning,
} from "./largeFileWarning";

describe("large file warning", () => {
  it("warns for a long PNG sequence without blocking the selection", () => {
    const files = Array.from({ length: LONG_SEQUENCE_FILE_COUNT }, () => ({
      size: 1,
    }));
    const output = {
      hidden: true,
      textContent: "",
    } as HTMLElement;

    renderLargeFileWarning(output, "png-sequence", files);

    expect(output).toMatchObject({
      hidden: false,
      textContent: LARGE_FILE_WARNING,
    });
  });

  it("warns when the selected source files have a very large total size", () => {
    expect(
      getLargeFileWarning("spritesheet-grid", [
        { size: LARGE_SOURCE_SIZE_BYTES },
      ]),
    ).toBe(LARGE_FILE_WARNING);
  });

  it("keeps the warning hidden for ordinary selections", () => {
    const output = {
      hidden: false,
      textContent: "stale warning",
    } as HTMLElement;

    renderLargeFileWarning(output, "png-sequence", [
      { size: LARGE_SOURCE_SIZE_BYTES - 1 },
    ]);

    expect(output).toMatchObject({ hidden: true, textContent: "" });
  });
});
