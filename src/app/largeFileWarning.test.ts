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

    expect(output.hidden).toBe(false);
    expect(output.textContent).toContain(LARGE_FILE_WARNING);
    expect(output.textContent).toContain("does not block conversion");
    expect(output.textContent).toContain("browser-local");
  });

  it("warns when the selected source files have a very large total size", () => {
    const warning = getLargeFileWarning("spritesheet-grid", [
      { size: LARGE_SOURCE_SIZE_BYTES },
    ]);

    expect(warning).toContain(LARGE_FILE_WARNING);
    expect(warning).toContain(
      "Compressed source size is only a rough risk signal",
    );
    expect(warning).toContain("not uploaded for estimation");
  });

  it("warns when decoded RGBA pixels are large even if the source file is small", () => {
    const warning = getLargeFileWarning(
      "spritesheet-grid",
      [{ size: 1024 }],
      { decodedRgbaEstimate: { width: 8192, height: 8192 } },
    );

    expect(warning).toContain("about 256 MiB");
    expect(warning).toContain("8192 x 8192 x 4 bytes");
    expect(warning).toContain("no telemetry");
  });

  it("includes frame and layer multipliers in decoded RGBA estimates", () => {
    const warning = getLargeFileWarning(
      "psd",
      [{ size: 1024 }],
      {
        decodedRgbaEstimate: {
          width: 1024,
          height: 1024,
          frames: 10,
          layers: 3,
        },
      },
    );

    expect(warning).toContain("about 120 MiB");
    expect(warning).toContain("1024 x 1024 x 4 bytes x 10 frames x 3 layers");
    expect(warning).toContain("source format contains layer data");
  });

  it("keeps the warning hidden for ordinary selections", () => {
    const output = {
      hidden: false,
      textContent: "stale warning",
    } as HTMLElement;

    renderLargeFileWarning(
      output,
      "png-sequence",
      [{ size: LARGE_SOURCE_SIZE_BYTES - 1 }],
      { decodedRgbaEstimate: { width: 128, height: 128 } },
    );

    expect(output).toMatchObject({ hidden: true, textContent: "" });
  });
});
