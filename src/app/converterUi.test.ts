import { afterEach, describe, expect, it, vi } from "vitest";

import type { SpriteProject } from "../core/SpriteProject";
import { ApngImportError } from "../core/importers/apng";
import { GifImportError } from "../core/importers/gif";
import { KritaImportError } from "../core/importers/krita";
import { OpenRasterImportError } from "../core/importers/openraster";
import { PixeloramaImportError } from "../core/importers/pixelorama";
import { PixilImportError } from "../core/importers/pixil";
import { PsdParserAdapterError } from "../core/importers/psd";
import {
  PiskelImportError,
  type PiskelImportErrorCode,
} from "../core/importers/piskel";
import type { SpritesheetGridImportOptions } from "../core/importers/spritesheetGrid";
import { SpritesheetJsonImportError } from "../core/importers/spritesheetJson";
import {
  calculateExactFitGrid,
  calculateFrameSizeFromGrid,
  calculateGridFromImage,
  convertSourceFiles,
  createGridUpdateGuard,
  getConversionErrorMessage,
  getConversionSuccessStatus,
  getGridPreviewState,
  getImportDropInstructions,
  getModeHelp,
  getSourceSelectionError,
  getSourceSelectionState,
  findNearestDivisor,
  mountConverterUi,
  MODE_LABELS,
  renderConversionState,
} from "./converterUi";
import type { BrowserSourceFile } from "./fileImport";

const gridOptions: SpritesheetGridImportOptions = {
  frameWidth: 16,
  frameHeight: 16,
  rows: 2,
  columns: 3,
  frameOrder: "row-major",
};

const project: SpriteProject = {
  width: 16,
  height: 16,
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

function png(name: string): BrowserSourceFile {
  return {
    file: new File(["png"], name, { type: "image/png" }),
    kind: "png",
    bytes: new ArrayBuffer(0),
  };
}

function json(name: string): BrowserSourceFile {
  return {
    file: new File(["{}"], name, { type: "application/json" }),
    kind: "json",
    text: "{}",
  };
}

function piskel(name: string): BrowserSourceFile {
  return {
    file: new File(["{}"], name, { type: "application/octet-stream" }),
    kind: "piskel",
    text: "{}",
  };
}

function pixil(name: string): BrowserSourceFile {
  return {
    file: new File(["pixil"], name, { type: "application/octet-stream" }),
    kind: "pixil",
    bytes: new ArrayBuffer(0),
  };
}

function validPixilProjectJson(): string {
  return JSON.stringify({
    application: "pixil",
    type: ".pixil",
    version: "2.7.0",
    website: "pixilart.com",
    width: "1",
    height: "1",
    frames: [
      {
        speed: 100,
        width: "1",
        height: "1",
        layers: [
          {
            id: 0,
            src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X5WzAAAAAElFTkSuQmCC",
            name: "Ink",
            opacity: "1",
            active: true,
            unqid: "ink-layer",
            options: { blend: "source-over" },
          },
        ],
      },
    ],
  });
}

function gif(name: string): BrowserSourceFile {
  return {
    file: new File(["gif"], name, { type: "image/gif" }),
    kind: "gif",
    bytes: new ArrayBuffer(0),
  };
}

function apng(name: string): BrowserSourceFile {
  return {
    file: new File(["apng"], name, { type: "image/png" }),
    kind: "apng",
    bytes: new ArrayBuffer(0),
  };
}

function ora(name: string): BrowserSourceFile {
  return {
    file: new File(["ora"], name, { type: "image/openraster" }),
    kind: "ora",
    bytes: new ArrayBuffer(0),
  };
}

function pxo(name: string): BrowserSourceFile {
  return {
    file: new File(["pxo"], name, { type: "application/x-pixelorama" }),
    kind: "pxo",
    bytes: new ArrayBuffer(0),
  };
}

function kra(name: string): BrowserSourceFile {
  return {
    file: new File(["kra"], name, { type: "application/x-krita" }),
    kind: "kra",
    bytes: new ArrayBuffer(0),
  };
}

function psd(name: string): BrowserSourceFile {
  return {
    file: new File(["psd"], name, { type: "image/vnd.adobe.photoshop" }),
    kind: "psd",
    bytes: new ArrayBuffer(0),
  };
}

function elementStub(): HTMLElement {
  const attributes = new Map<string, string>();
  return {
    hidden: false,
    inert: false,
    textContent: "",
    setAttribute(name: string, value: string): void {
      attributes.set(name, value);
    },
    getAttribute(name: string): string | null {
      return attributes.get(name) ?? null;
    },
  } as unknown as HTMLElement;
}

type Listener = EventListenerOrEventListenerObject;

class UiElementStub {
  readonly attributes = new Map<string, string>();
  readonly children: UiElementStub[] = [];
  readonly listeners = new Map<string, Listener>();
  accept = "";
  alt = "";
  className = "";
  disabled = false;
  files: File[] = [];
  hidden = false;
  href = "";
  id = "";
  inert = false;
  max = "";
  min = "";
  multiple = false;
  rel = "";
  required = false;
  src = "";
  step = "";
  style = { backgroundSize: "" };
  target = "";
  textContent = "";
  type = "";
  value = "";
  parent: UiElementStub | null = null;

  constructor(
    readonly tagName: string,
    readonly ownerDocument: UiDocumentStub,
  ) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }

  append(...children: (UiElementStub | string)[]): void {
    for (const child of children) {
      if (typeof child === "string") {
        this.textContent += child;
      } else {
        child.parent = this;
        this.children.push(child);
        if (
          this.tagName === "select" &&
          child.tagName === "option" &&
          this.value.length === 0
        ) {
          this.value = child.value;
        }
      }
    }
  }

  click(): void {
    trigger(this, "click");
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getContext(): CanvasRenderingContext2D | null {
    if (this.tagName !== "canvas") return null;
    return {
      drawImage: vi.fn(),
      getImageData: () => ({
        width: 1,
        height: 1,
        data: new Uint8ClampedArray(4),
        colorSpace: "srgb",
      }),
    } as unknown as CanvasRenderingContext2D;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  replaceChildren(...children: UiElementStub[]): void {
    for (const child of this.children) {
      child.parent = null;
    }
    for (const child of children) {
      child.parent = this;
    }
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class UiDocumentStub {
  createElement(tagName: string): UiElementStub {
    return new UiElementStub(tagName, this);
  }
}

function trigger(element: UiElementStub, type: string): void {
  const listener = element.listeners.get(type);
  if (typeof listener === "function") {
    listener({ preventDefault: vi.fn() } as unknown as Event);
  } else if (listener !== undefined) {
    listener.handleEvent({ preventDefault: vi.fn() } as unknown as Event);
  }
}

function findAll(
  element: UiElementStub,
  predicate: (element: UiElementStub) => boolean,
): UiElementStub[] {
  return [
    ...(predicate(element) ? [element] : []),
    ...element.children.flatMap((child) => findAll(child, predicate)),
  ];
}

function findOne(
  element: UiElementStub,
  predicate: (element: UiElementStub) => boolean,
): UiElementStub {
  const match = findAll(element, predicate)[0];
  if (match === undefined) {
    throw new Error("Expected a matching UI element.");
  }
  return match;
}

function getText(element: UiElementStub): string {
  return [
    element.textContent,
    ...element.children.map((child) => getText(child)),
  ].join("");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderConversionState", () => {
  it("exposes an accessible working state and locks conversion controls", () => {
    const activityControl = elementStub();
    const progress = elementStub();
    const status = elementStub();
    const error = elementStub();
    const dropZone = elementStub();
    const modeSelect = { disabled: false } as HTMLSelectElement;
    const fileInput = { disabled: false } as HTMLInputElement;
    const convertButton = { disabled: false } as HTMLButtonElement;
    const elements = {
      activityControl,
      progress,
      status,
      error,
      sourceControls: [modeSelect, fileInput],
      dropZone,
      convertButton,
    };

    renderConversionState(elements, {
      isWorking: true,
      canConvert: true,
      status: "Converting files browser-locally. This may take a while.",
    });

    expect(activityControl.getAttribute("aria-busy")).toBe("true");
    expect(progress.hidden).toBe(false);
    expect(status.textContent).toContain("browser-locally");
    expect(error).toMatchObject({ hidden: true, textContent: "" });
    expect(convertButton.disabled).toBe(true);
    expect(modeSelect.disabled).toBe(true);
    expect(fileInput.disabled).toBe(true);
    expect(dropZone.inert).toBe(true);
    expect(dropZone.getAttribute("aria-disabled")).toBe("true");

    renderConversionState(elements, {
      isWorking: false,
      canConvert: true,
      status: "Conversion did not complete.",
      error: "The spritesheet grid is invalid.",
    });

    expect(activityControl.getAttribute("aria-busy")).toBe("false");
    expect(progress.hidden).toBe(true);
    expect(status.textContent).toBe("Conversion did not complete.");
    expect(error).toMatchObject({
      hidden: false,
      textContent: "The spritesheet grid is invalid.",
    });
    expect(convertButton.disabled).toBe(false);
    expect(modeSelect.disabled).toBe(false);
    expect(fileInput.disabled).toBe(false);
    expect(dropZone.inert).toBe(false);
    expect(dropZone.getAttribute("aria-disabled")).toBe("false");
  });
});

describe("getSourceSelectionError", () => {
  it("accepts the required file combination for each import mode", () => {
    expect(getSourceSelectionError("png-sequence", [png("1.png"), png("2.png")]))
      .toBeNull();
    expect(getSourceSelectionError("spritesheet-grid", [png("sheet.png")]))
      .toBeNull();
    expect(
      getSourceSelectionError("spritesheet-json", [
        png("sheet.png"),
        json("sheet.json"),
      ]),
    ).toBeNull();
    expect(getSourceSelectionError("piskel", [piskel("sprite.piskel")]))
      .toBeNull();
    expect(getSourceSelectionError("pixil", [pixil("sprite.pixil")]))
      .toBeNull();
    expect(getSourceSelectionError("gif", [gif("sprite.gif")])).toBeNull();
    expect(getSourceSelectionError("apng", [apng("sprite.apng")])).toBeNull();
    expect(getSourceSelectionError("apng", [png("sprite.png")])).toBeNull();
    expect(getSourceSelectionError("openraster", [ora("scene.ora")]))
      .toBeNull();
    expect(getSourceSelectionError("pixelorama", [pxo("scene.pxo")]))
      .toBeNull();
    expect(getSourceSelectionError("krita", [kra("scene.kra")])).toBeNull();
    expect(getSourceSelectionError("psd", [psd("scene.psd")])).toBeNull();
  });

  it("rejects mode/file mismatches before conversion", () => {
    expect(getSourceSelectionError("png-sequence", [json("frames.json")]))
      .toContain("one or more PNG files");
    expect(
      getSourceSelectionError("spritesheet-grid", [
        png("one.png"),
        png("two.png"),
      ]),
    ).toContain("exactly one PNG file");
    expect(getSourceSelectionError("spritesheet-json", [png("sheet.png")]))
      .toContain("one PNG and one JSON file");
    expect(getSourceSelectionError("piskel", [png("sprite.png")]))
      .toContain("exactly one .piskel file");
    expect(
      getSourceSelectionError("piskel", [
        piskel("one.piskel"),
        piskel("two.piskel"),
      ]),
    ).toContain("exactly one .piskel file");
    expect(getSourceSelectionError("pixil", [png("sprite.png")]))
      .toContain("exactly one .pixil file");
    expect(
      getSourceSelectionError("pixil", [
        pixil("one.pixil"),
        pixil("two.pixil"),
      ]),
    ).toContain("exactly one .pixil file");
    expect(getSourceSelectionError("gif", [png("sprite.png")]))
      .toContain("exactly one .gif file");
    expect(getSourceSelectionError("gif", [gif("one.gif"), gif("two.gif")]))
      .toContain("exactly one .gif file");
    expect(getSourceSelectionError("apng", [gif("sprite.gif")]))
      .toContain("exactly one .apng");
    expect(getSourceSelectionError("apng", [
      apng("one.apng"),
      apng("two.apng"),
    ])).toContain("exactly one .apng");
    expect(getSourceSelectionError("openraster", [png("sprite.png")]))
      .toContain("exactly one .ora file");
    expect(getSourceSelectionError("openraster", [
      ora("one.ora"),
      ora("two.ora"),
    ])).toContain("exactly one .ora file");
    expect(getSourceSelectionError("pixelorama", [png("sprite.png")]))
      .toContain("exactly one .pxo file");
    expect(getSourceSelectionError("pixelorama", [
      pxo("one.pxo"),
      pxo("two.pxo"),
    ])).toContain("exactly one .pxo file");
    expect(getSourceSelectionError("krita", [png("sprite.png")]))
      .toContain("exactly one .kra file");
    expect(getSourceSelectionError("krita", [
      kra("one.kra"),
      kra("two.kra"),
    ])).toContain("exactly one .kra file");
    expect(getSourceSelectionError("psd", [png("sprite.png")]))
      .toContain("exactly one .psd file");
  });

  it("accepts PSD selections with the documented subset limitation", () => {
    const selectedPsd = [psd("sprite.psd")];

    expect(getSourceSelectionError("psd", selectedPsd)).toBeNull();
    expect(getSourceSelectionState("psd", selectedPsd)).toEqual({
      canConvert: true,
      error: null,
      status: "Source files are ready to convert.",
    });
  });

  it("accepts one Pixil project for conversion", () => {
    const selectedPixil = [pixil("sprite.pixil")];

    expect(getSourceSelectionError("pixil", selectedPixil)).toBeNull();
    expect(getSourceSelectionState("pixil", selectedPixil)).toEqual({
      canConvert: true,
      error: null,
      status: "Source files are ready to convert.",
    });
  });

  it("revalidates remaining and cleared files without a second selection state", () => {
    const files = [png("sheet.png"), json("sheet.json")];
    expect(getSourceSelectionState("spritesheet-json", files).canConvert)
      .toBe(true);
    expect(
      getSourceSelectionState("spritesheet-json", files.slice(0, 1)),
    ).toMatchObject({
      canConvert: false,
      error: expect.stringContaining("one PNG and one JSON"),
    });
    expect(getSourceSelectionState("spritesheet-json", [])).toEqual({
      canConvert: false,
      error: null,
      status: "Choose source files to begin.",
    });
  });

  it("disables single-file project conversion after removing or clearing the file", () => {
    expect(getSourceSelectionState("gif", [gif("sprite.gif")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("gif", []).canConvert).toBe(false);
    expect(getSourceSelectionState("apng", [apng("sprite.apng")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("apng", []).canConvert).toBe(false);
    expect(getSourceSelectionState("openraster", [ora("scene.ora")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("openraster", []).canConvert).toBe(false);
    expect(getSourceSelectionState("pixelorama", [pxo("scene.pxo")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("pixelorama", []).canConvert).toBe(false);
    expect(getSourceSelectionState("krita", [kra("scene.kra")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("krita", []).canConvert).toBe(false);
    expect(getSourceSelectionState("psd", [psd("scene.psd")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("psd", []).canConvert).toBe(false);
    expect(getSourceSelectionState("pixil", [pixil("scene.pixil")]).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("pixil", []).canConvert).toBe(false);
  });

  it("revalidates the same selected files when import mode changes", () => {
    const files = [png("sheet.png")];
    expect(getSourceSelectionState("spritesheet-grid", files).canConvert)
      .toBe(true);
    expect(getSourceSelectionState("piskel", files).canConvert).toBe(false);
    expect(getSourceSelectionState("pixelorama", files).canConvert).toBe(false);
    expect(getSourceSelectionState("krita", files).canConvert).toBe(false);
    expect(getSourceSelectionState("psd", files).canConvert).toBe(false);
    expect(getSourceSelectionState("pixil", files).canConvert).toBe(false);
  });

  it("exposes project mode labels without implying full compatibility", () => {
    expect(MODE_LABELS.krita).toBe("Krita project");
    expect(getImportDropInstructions("krita")).toBe(
      "Drop exactly one .kra file from the documented minimal raster subset here, or choose one below.",
    );
    expect(MODE_LABELS.psd).toBe("PSD project");
    const psdInstructions = getImportDropInstructions("psd");
    expect(psdInstructions).toBe(
      "Drop exactly one .psd file from the RGB 8-bit raster-layer subset here, or choose one below.",
    );
    expect(psdInstructions).not.toContain("lossless");
    expect(psdInstructions).not.toContain("text layers");
    expect(MODE_LABELS.pixil).toBe("Pixil/Pixilart project");
    const pixilInstructions = getImportDropInstructions("pixil");
    expect(pixilInstructions).toBe(
      "Drop exactly one .pixil Pixil/Pixilart project file here, or choose one below. Import is limited to the documented project-file subset.",
    );
    expect(pixilInstructions).not.toContain("lossless");
    expect(pixilInstructions).not.toContain("full");
  });
});

describe("mountConverterUi Pixil selection", () => {
  it("renders a separated converter workspace with mode-specific guidance", () => {
    vi.stubGlobal("HTMLImageElement", class HTMLImageElementStub {});
    const document = new UiDocumentStub();
    const root = document.createElement("main");
    mountConverterUi(root as unknown as HTMLElement);

    expect(findOne(root, (element) => element.id === "converter")).toBeTruthy();
    expect(getText(root)).toContain("Converter workspace");
    expect(getText(root)).toContain("Choose the right conversion mode");
    expect(getText(root)).toContain(
      "Expected files: One or more PNG files with the same canvas size.",
    );
    expect(getText(root)).toContain(
      "Flat PNG files do not contain original source layers.",
    );

    const modeSelect = findOne(root, (element) => element.tagName === "select");
    modeSelect.value = "psd";
    trigger(modeSelect, "change");

    expect(getText(root)).toContain(
      "Expected files: Exactly one `.psd` file from the RGB 8-bit raster-layer subset.",
    );
    expect(getText(root)).toContain("smart objects");
    expect(getText(root)).toContain("outside the supported subset");
  });

  it("keeps mode guidance accurate without claiming lossless conversion", () => {
    expect(getModeHelp("spritesheet-json")).toMatchObject({
      expectedFiles:
        "Exactly one PNG spritesheet and one matching supported JSON atlas file.",
    });
    expect(getModeHelp("gif").limitations).toContain(
      "original source layers cannot be recovered",
    );
    expect(getModeHelp("pixil").limitations).toContain(
      "unverified editor features are rejected clearly",
    );
    expect(Object.values(getModeHelp("psd")).join(" ")).not.toContain(
      "lossless",
    );
  });

  it("shows Pixil cards and keeps remove and clear behavior in sync", async () => {
    vi.stubGlobal("HTMLImageElement", class HTMLImageElementStub {});
    const document = new UiDocumentStub();
    const root = document.createElement("main");
    mountConverterUi(root as unknown as HTMLElement);

    const modeSelect = findOne(root, (element) => element.tagName === "select");
    const fileInput = findOne(
      root,
      (element) => element.tagName === "input" && element.type === "file",
    );
    const convertButton = findOne(
      root,
      (element) =>
        element.tagName === "button" &&
        element.textContent === "Convert to .aseprite",
    );

    modeSelect.value = "pixil";
    trigger(modeSelect, "change");
    expect(getText(root)).toContain(
      "Import is limited to the documented project-file subset",
    );

    const pixilFile = new File([validPixilProjectJson()], "sprite.pixil", {
      type: "application/octet-stream",
    });
    fileInput.files = [pixilFile];
    trigger(fileInput, "change");

    await vi.waitFor(() => {
      expect(
        findAll(root, (element) =>
          element.className.split(/\s+/).includes("selected-file-card"),
        ),
      ).toHaveLength(1);
    });
    expect(getText(root)).toContain("sprite.pixil");
    expect(getText(root)).toContain("Pixil project");
    expect(getText(root)).toContain("PIXIL");
    expect(getText(root)).toContain(
      "Source files are ready to convert.",
    );
    expect(getText(root)).not.toContain("rgbaBase64");
    expect(convertButton.disabled).toBe(false);

    findOne(
      root,
      (element) =>
        element.tagName === "button" &&
        element.textContent === "Remove sprite.pixil",
    ).click();
    expect(
      findAll(root, (element) =>
        element.className.split(/\s+/).includes("selected-file-card"),
      ),
    ).toHaveLength(0);
    expect(convertButton.disabled).toBe(true);
    expect(getText(root)).toContain("Choose source files to begin.");

    fileInput.files = [pixilFile];
    trigger(fileInput, "change");
    await vi.waitFor(() => {
      expect(
        findAll(root, (element) =>
          element.className.split(/\s+/).includes("selected-file-card"),
        ),
      ).toHaveLength(1);
    });

    findOne(
      root,
      (element) =>
        element.tagName === "button" &&
        element.textContent === "Clear selected files",
    ).click();
    expect(
      findAll(root, (element) =>
        element.className.split(/\s+/).includes("selected-file-card"),
      ),
    ).toHaveLength(0);
    expect(convertButton.disabled).toBe(true);
  });

  it("converts a Pixil project into preview and download state", async () => {
    vi.stubGlobal("HTMLImageElement", class HTMLImageElementStub {});
    vi.stubGlobal("createImageBitmap", async () => ({
      width: 1,
      height: 1,
      close: vi.fn(),
    }));
    const document = new UiDocumentStub();
    vi.stubGlobal("document", document);
    const root = document.createElement("main");
    mountConverterUi(root as unknown as HTMLElement);

    const modeSelect = findOne(root, (element) => element.tagName === "select");
    const fileInput = findOne(
      root,
      (element) => element.tagName === "input" && element.type === "file",
    );
    const convertButton = findOne(
      root,
      (element) =>
        element.tagName === "button" &&
        element.textContent === "Convert to .aseprite",
    );
    const downloadButton = findOne(
      root,
      (element) =>
        element.tagName === "button" &&
        element.textContent === "Download .aseprite",
    );

    modeSelect.value = "pixil";
    trigger(modeSelect, "change");
    fileInput.files = [
      new File([validPixilProjectJson()], "sprite.pixil", {
        type: "application/octet-stream",
      }),
    ];
    trigger(fileInput, "change");

    await vi.waitFor(() => expect(convertButton.disabled).toBe(false));
    expect(downloadButton.disabled).toBe(true);

    convertButton.click();

    await vi.waitFor(() => {
      expect(getText(root)).toContain(
        "Converted supported Pixil frames and layers into an editable Aseprite timeline with 1 frame and 1 preserved layer. Ready to download.",
      );
    });
    expect(getText(root)).toContain("Frame 1 of 1, 100 milliseconds.");
    expect(getText(root)).toContain("Layer 1 name");
    expect(downloadButton.disabled).toBe(false);
  });

  it("shows Pixil conversion errors without source contents or stack traces", async () => {
    vi.stubGlobal("HTMLImageElement", class HTMLImageElementStub {});
    const document = new UiDocumentStub();
    const root = document.createElement("main");
    mountConverterUi(root as unknown as HTMLElement);

    const modeSelect = findOne(root, (element) => element.tagName === "select");
    const fileInput = findOne(
      root,
      (element) => element.tagName === "input" && element.type === "file",
    );
    const convertButton = findOne(
      root,
      (element) =>
        element.tagName === "button" &&
        element.textContent === "Convert to .aseprite",
    );
    const privateContents = '{"private pixels":"do not display"';

    modeSelect.value = "pixil";
    trigger(modeSelect, "change");
    fileInput.files = [
      new File([privateContents], "sprite.pixil", {
        type: "application/octet-stream",
      }),
    ];
    trigger(fileInput, "change");

    await vi.waitFor(() => expect(convertButton.disabled).toBe(false));
    convertButton.click();

    await vi.waitFor(() => {
      expect(getText(root)).toContain("Pixil conversion did not complete.");
      expect(getText(root)).toContain(
        "Pixil/Pixilart import failed: Pixil file is not valid JSON.",
      );
    });
    expect(getText(root)).not.toContain(privateContents);
    expect(getText(root)).not.toContain("PixilImportError");
  });
});

describe("spritesheet grid preview calculations", () => {
  it("preserves exact frame divisors and snaps frame edits to nearest divisors", () => {
    expect(calculateGridFromImage(128, 96, 32, 32)).toEqual({
      columns: 4,
      rows: 3,
      warning: null,
    });
    expect(calculateGridFromImage(384, 256, 30, 32)).toEqual({
      columns: 12,
      rows: 8,
      warning: null,
    });
    expect(calculateGridFromImage(384, 256, 32, 30)).toEqual({
      columns: 12,
      rows: 8,
      warning: null,
    });
  });

  it("snaps row and column edits and updates exact frame dimensions", () => {
    expect(calculateFrameSizeFromGrid(384, 256, 12, 8)).toEqual({
      frameHeight: 32,
      frameWidth: 32,
      warning: null,
    });
    expect(
      calculateExactFitGrid(
        384,
        256,
        { ...gridOptions, columns: 10, rows: 8 },
        "grid-size",
      ).values,
    ).toEqual({
      columns: 12,
      frameHeight: 32,
      frameWidth: 32,
      rows: 8,
    });
    expect(calculateFrameSizeFromGrid(384, 250, 12, 8)).toEqual({
      frameHeight: 25,
      frameWidth: 32,
      warning: null,
    });
  });

  it("chooses the larger divisor when nearest divisors are tied", () => {
    expect(findNearestDivisor(384, 10)).toBe(12);
    expect(findNearestDivisor(256, 10)).toBe(8);
  });

  it("returns normalized controls and an adjustment status", () => {
    expect(
      calculateExactFitGrid(
        384,
        256,
        { ...gridOptions, frameWidth: 30, frameHeight: 30 },
        "frame-size",
      ),
    ).toEqual({
      message: "Adjusted to exact fit: 12 columns × 8 rows, 32 × 32 px each.",
      values: {
        columns: 12,
        frameHeight: 32,
        frameWidth: 32,
        rows: 8,
      },
    });
    expect(
      calculateExactFitGrid(
        384,
        256,
        { ...gridOptions, columns: 12, rows: 8, frameWidth: 32, frameHeight: 32 },
        "grid-size",
      ).message,
    ).toBe("Exact fit: 12 columns × 8 rows, 32 × 32 px each.");
  });

  it("rejects invalid inputs without producing unsafe grid values", () => {
    expect(calculateGridFromImage(128, 96, 0, 32)).toMatchObject({
      columns: null,
      rows: null,
      warning: expect.stringContaining("positive whole numbers"),
    });
    for (const invalidValue of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const result = calculateExactFitGrid(
        128,
        96,
        { ...gridOptions, columns: invalidValue },
        "grid-size",
      );
      expect(result.values).toBeNull();
      expect(result.message).toContain("Enter a valid");
    }
    expect(
      getGridPreviewState(128, 96, { ...gridOptions, frameWidth: 0 }),
    ).toMatchObject({
      canConvert: false,
      description:
        "Grid preview unavailable: choose one PNG and enter valid grid settings.",
    });
  });

  it("updates accessible preview details for manual row and column changes", () => {
    expect(getGridPreviewState(128, 96, gridOptions)).toMatchObject({
      canConvert: false,
      description:
        "Grid preview: 3 columns × 2 rows, 6 frames, 16 × 16 px each.",
      warning: expect.stringContaining("do not cover"),
    });
    expect(getGridPreviewState(48, 32, gridOptions)).toMatchObject({
      canConvert: true,
      description:
        "Grid preview: 3 columns × 2 rows, 6 frames, 16 × 16 px each.",
      details: {
        frameSize: "Frame size: 16 × 16 px",
        gridSize: "Grid: 3 columns × 2 rows",
        imageSize: "Image size: 48 × 32 px",
        totalFrames: "Total frames: 6",
      },
      warning: null,
    });
    expect(
      getGridPreviewState(48, 32, { ...gridOptions, columns: 4 }),
    ).toMatchObject({
      canConvert: false,
      description:
        "Grid preview: 4 columns × 2 rows, 8 frames, 16 × 16 px each.",
      warning: expect.stringContaining("exceeds"),
    });
  });

  it("shows an exact summary without an uneven warning after snapping", () => {
    const calculation = calculateExactFitGrid(
      384,
      250,
      { ...gridOptions, columns: 12, rows: 8 },
      "grid-size",
    );
    expect(calculation.values).toEqual({
      columns: 12,
      frameHeight: 25,
      frameWidth: 32,
      rows: 10,
    });
    const preview = getGridPreviewState(384, 250, {
      ...gridOptions,
      ...calculation.values!,
    });
    expect(preview.warning).toBeNull();
    expect(preview.description).toBe(
      "Grid preview: 12 columns × 10 rows, 120 frames, 32 × 25 px each.",
    );
    expect(preview.details).toEqual({
      frameSize: "Frame size: 32 × 25 px",
      gridSize: "Grid: 12 columns × 10 rows",
      imageSize: "Image size: 384 × 250 px",
      totalFrames: "Total frames: 120",
    });
  });

  it("recalculates dimensions and summary when the selected image changes", () => {
    const firstGrid = calculateExactFitGrid(
      384,
      256,
      { ...gridOptions, frameWidth: 32, frameHeight: 32 },
      "image-change",
    );
    const secondGrid = calculateExactFitGrid(
      320,
      160,
      { ...gridOptions, frameWidth: 32, frameHeight: 32 },
      "image-change",
    );
    expect(firstGrid.values).toMatchObject({ columns: 12, rows: 8 });
    expect(secondGrid.values).toMatchObject({ columns: 10, rows: 5 });

    expect(
      getGridPreviewState(320, 160, {
        ...gridOptions,
        ...secondGrid.values!,
      }).description,
    ).toBe("Grid preview: 10 columns × 5 rows, 50 frames, 32 × 32 px each.");
  });

  it("blocks nested grid updates to prevent recursive input loops", () => {
    const guard = createGridUpdateGuard();
    const updates: string[] = [];

    expect(guard.run("frame-size", () => {
      updates.push("frame-size");
      expect(guard.run("grid-size", () => updates.push("grid-size")))
        .toBe(false);
    })).toBe(true);
    expect(updates).toEqual(["frame-size"]);
    expect(guard.run("grid-size", () => updates.push("later"))).toBe(true);
    expect(updates).toEqual(["frame-size", "later"]);
  });
});

describe("convertSourceFiles", () => {
  it("delegates every mode to the existing importer with the selected files", async () => {
    const importPngSequence = vi.fn(async () => project);
    const importApng = vi.fn(async () => project);
    const importGif = vi.fn(async () => project);
    const importKrita = vi.fn(async () => project);
    const importOpenRaster = vi.fn(async () => project);
    const importPixelorama = vi.fn(async () => project);
    const importPixil = vi.fn(async () => project);
    const importPiskel = vi.fn(async () => project);
    const importPsd = vi.fn(async () => project);
    const importSpritesheetGrid = vi.fn(async () => project);
    const importSpritesheetJson = vi.fn(async () => project);
    const importers = {
      importApng,
      importGif,
      importKrita,
      importOpenRaster,
      importPixelorama,
      importPixil,
      importPngSequence,
      importPiskel,
      importPsd,
      importSpritesheetGrid,
      importSpritesheetJson,
    };
    const firstPng = png("walk-01.png");
    const secondPng = png("walk-02.png");
    const metadata = json("walk.json");
    const piskelProject = piskel("walk.piskel");
    const gifAnimation = gif("walk.gif");
    const apngAnimation = apng("walk.apng");
    const openRasterProject = ora("scene.ora");
    const pixeloramaProject = pxo("scene.pxo");
    const pixilProject = pixil("scene.pixil");
    const kritaProject = kra("scene.kra");
    const psdProject = psd("scene.psd");

    await expect(
      convertSourceFiles(
        "png-sequence",
        [firstPng, secondPng],
        gridOptions,
        importers,
      ),
    ).resolves.toBe(project);
    expect(importPngSequence).toHaveBeenCalledWith([
      firstPng.file,
      secondPng.file,
    ]);

    await convertSourceFiles(
      "spritesheet-grid",
      [firstPng],
      gridOptions,
      importers,
    );
    expect(importSpritesheetGrid).toHaveBeenCalledWith(
      firstPng.file,
      gridOptions,
    );

    await convertSourceFiles(
      "spritesheet-json",
      [firstPng, metadata],
      gridOptions,
      importers,
    );
    expect(importSpritesheetJson).toHaveBeenCalledWith(
      firstPng.file,
      metadata.file,
    );

    await convertSourceFiles(
      "piskel",
      [piskelProject],
      gridOptions,
      importers,
    );
    expect(importPiskel).toHaveBeenCalledWith(piskelProject.file);

    await convertSourceFiles("gif", [gifAnimation], gridOptions, importers);
    expect(importGif).toHaveBeenCalledWith(gifAnimation.file);

    await convertSourceFiles("apng", [apngAnimation], gridOptions, importers);
    expect(importApng).toHaveBeenCalledWith(apngAnimation.file);

    const pngContainer = png("walk.png");
    await convertSourceFiles("apng", [pngContainer], gridOptions, importers);
    expect(importApng).toHaveBeenCalledWith(pngContainer.file);

    await convertSourceFiles(
      "openraster",
      [openRasterProject],
      gridOptions,
      importers,
    );
    expect(importOpenRaster).toHaveBeenCalledWith(openRasterProject.file);

    await convertSourceFiles(
      "pixelorama",
      [pixeloramaProject],
      gridOptions,
      importers,
    );
    expect(importPixelorama).toHaveBeenCalledWith(pixeloramaProject.file);

    await convertSourceFiles("pixil", [pixilProject], gridOptions, importers);
    expect(importPixil).toHaveBeenCalledWith(pixilProject.file);

    await convertSourceFiles(
      "krita",
      [kritaProject],
      gridOptions,
      importers,
    );
    expect(importKrita).toHaveBeenCalledWith(kritaProject.file);

    await convertSourceFiles("psd", [psdProject], gridOptions, importers);
    expect(importPsd).toHaveBeenCalledWith(psdProject.file);
  });

  it("does not call an importer for an invalid selection", async () => {
    const importers = {
      importApng: vi.fn(async () => project),
      importGif: vi.fn(async () => project),
      importKrita: vi.fn(async () => project),
      importOpenRaster: vi.fn(async () => project),
      importPixelorama: vi.fn(async () => project),
      importPixil: vi.fn(async () => project),
      importPngSequence: vi.fn(async () => project),
      importPiskel: vi.fn(async () => project),
      importPsd: vi.fn(async () => project),
      importSpritesheetGrid: vi.fn(async () => project),
      importSpritesheetJson: vi.fn(async () => project),
    };

    await expect(
      convertSourceFiles(
        "spritesheet-json",
        [png("sheet.png")],
        gridOptions,
        importers,
      ),
    ).rejects.toThrow("exactly one PNG and one JSON file");
    expect(importers.importPngSequence).not.toHaveBeenCalled();
    expect(importers.importPiskel).not.toHaveBeenCalled();
    expect(importers.importSpritesheetGrid).not.toHaveBeenCalled();
    expect(importers.importSpritesheetJson).not.toHaveBeenCalled();
    expect(importers.importGif).not.toHaveBeenCalled();
    expect(importers.importApng).not.toHaveBeenCalled();
    expect(importers.importKrita).not.toHaveBeenCalled();
    expect(importers.importOpenRaster).not.toHaveBeenCalled();
    expect(importers.importPixelorama).not.toHaveBeenCalled();
    expect(importers.importPixil).not.toHaveBeenCalled();
    expect(importers.importPsd).not.toHaveBeenCalled();

    await expect(
      convertSourceFiles("psd", [png("scene.png")], gridOptions, importers),
    ).rejects.toThrow("PSD mode requires exactly one .psd file");
    expect(importers.importPngSequence).not.toHaveBeenCalled();
    expect(importers.importPiskel).not.toHaveBeenCalled();
    expect(importers.importSpritesheetGrid).not.toHaveBeenCalled();
    expect(importers.importSpritesheetJson).not.toHaveBeenCalled();
    expect(importers.importGif).not.toHaveBeenCalled();
    expect(importers.importApng).not.toHaveBeenCalled();
    expect(importers.importKrita).not.toHaveBeenCalled();
    expect(importers.importOpenRaster).not.toHaveBeenCalled();
    expect(importers.importPixelorama).not.toHaveBeenCalled();
    expect(importers.importPixil).not.toHaveBeenCalled();
    expect(importers.importPsd).not.toHaveBeenCalled();
  });

  it("does not call the Pixil importer for an invalid Pixil selection", async () => {
    const importers = {
      importApng: vi.fn(async () => project),
      importGif: vi.fn(async () => project),
      importKrita: vi.fn(async () => project),
      importOpenRaster: vi.fn(async () => project),
      importPixelorama: vi.fn(async () => project),
      importPixil: vi.fn(async () => project),
      importPngSequence: vi.fn(async () => project),
      importPiskel: vi.fn(async () => project),
      importPsd: vi.fn(async () => project),
      importSpritesheetGrid: vi.fn(async () => project),
      importSpritesheetJson: vi.fn(async () => project),
    };

    await expect(
      convertSourceFiles(
        "pixil",
        [pixil("one.pixil"), pixil("two.pixil")],
        gridOptions,
        importers,
      ),
    ).rejects.toThrow(
      "Pixil/Pixilart mode requires exactly one .pixil file.",
    );
    for (const importer of Object.values(importers)) {
      expect(importer).not.toHaveBeenCalled();
    }
  });
});

describe("Pixil project conversion messages", () => {
  const layeredProject: SpriteProject = {
    ...project,
    frames: [
      { index: 0, durationMs: 100 },
      { index: 1, durationMs: 120 },
    ],
    layers: [
      project.layers[0],
      {
        id: "shade",
        name: "Shade",
        visible: true,
        opacity: 128,
        cels: [],
      },
    ],
  };

  it("reports supported frames and layers without claiming lossless conversion", () => {
    const message = getConversionSuccessStatus("pixil", layeredProject);

    expect(message).toBe(
      "Converted supported Pixil frames and layers into an editable Aseprite timeline with 2 frames and 2 preserved layers. Ready to download.",
    );
    expect(message).not.toContain("lossless");
    expect(message).not.toContain("full");
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const error = new PixilImportError(
      "unsupported-feature",
      "Pixil layer 1 uses unsupported blend mode \"multiply\".",
    );
    error.stack = "private-pixil-stack";

    expect(getConversionErrorMessage("pixil", error)).toBe(
      "Pixil/Pixilart import failed: Pixil layer 1 uses unsupported blend mode \"multiply\".",
    );
    expect(getConversionErrorMessage("pixil", error)).not.toContain(
      "private-pixil-stack",
    );
  });

  it("does not expose arbitrary Pixil source details", () => {
    const privateMessage = "private pixil source details";
    const errorMessage = getConversionErrorMessage(
      "pixil",
      new Error(privateMessage),
    );

    expect(errorMessage).toBe(
      "Pixil/Pixilart import failed: Check that the .pixil file contains supported project-file frame and layer data from the documented subset.",
    );
    expect(errorMessage).not.toContain(privateMessage);
    expect(errorMessage).not.toContain("lossless");
  });
});

describe("PSD conversion messages", () => {
  const layeredProject: SpriteProject = {
    ...project,
    layers: [
      project.layers[0],
      {
        id: "shadow",
        name: "Shadow",
        visible: true,
        opacity: 128,
        cels: [],
      },
    ],
  };

  it("reports supported RGB 8-bit raster layers without overclaiming compatibility", () => {
    const message = getConversionSuccessStatus("psd", layeredProject);

    expect(message).toBe(
      "Converted supported PSD RGB 8-bit raster layers into an editable Aseprite timeline with 1 frame and 2 preserved layers. Ready to download.",
    );
    expect(message).not.toContain("lossless");
    expect(message).not.toContain("Photoshop compatibility");
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const error = new PsdParserAdapterError(
      "unsupported-feature",
      "PSD text layers are not supported.",
    );
    error.stack = "private-psd-stack";

    expect(getConversionErrorMessage("psd", error)).toBe(
      "PSD import failed: PSD text layers are not supported.",
    );
    expect(getConversionErrorMessage("psd", error)).not.toContain(
      "private-psd-stack",
    );
  });

  it("does not expose arbitrary PSD source details", () => {
    const privateMessage = "private PSD source details";
    const message = getConversionErrorMessage("psd", new Error(privateMessage));

    expect(message).toBe(
      "PSD import failed: Check that the .psd file contains supported RGB 8-bit raster layers from the documented subset.",
    );
    expect(message).not.toContain(privateMessage);
  });
});

describe("Krita conversion messages", () => {
  const layeredProject: SpriteProject = {
    ...project,
    layers: [
      project.layers[0],
      {
        id: "ink",
        name: "Ink",
        visible: true,
        opacity: 255,
        cels: [],
      },
    ],
  };

  it("reports supported raster layers and frame data without overclaiming compatibility", () => {
    expect(getConversionSuccessStatus("krita", layeredProject)).toBe(
      "Converted supported Krita raster layers and frame data into an editable Aseprite timeline with 1 frame and 2 preserved layers. Ready to download.",
    );
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const error = new KritaImportError(
      "unsupported-feature",
      "Krita animation timelines are unsupported.",
    );
    error.stack = "private-krita-stack";

    expect(getConversionErrorMessage("krita", error)).toBe(
      "Krita import failed: Krita animation timelines are unsupported.",
    );
    expect(getConversionErrorMessage("krita", error)).not.toContain(
      "private-krita-stack",
    );
  });

  it("does not expose arbitrary Krita errors", () => {
    const privateMessage = "private Krita source details";

    const message = getConversionErrorMessage(
      "krita",
      new Error(privateMessage),
    );

    expect(message).toBe(
      "Krita import failed: Check that the .kra file contains supported 8-bit RGBA paint layers from the documented minimal raster subset.",
    );
    expect(message).not.toContain(privateMessage);
  });
});

describe("Pixelorama conversion messages", () => {
  const layeredProject: SpriteProject = {
    ...project,
    frames: [
      { index: 0, durationMs: 100 },
      { index: 1, durationMs: 150 },
    ],
    layers: [
      project.layers[0],
      {
        id: "shadow",
        name: "Shadow",
        visible: true,
        opacity: 128,
        cels: [],
      },
    ],
  };

  it("reports supported frames and raster layers without overclaiming unsupported features", () => {
    expect(getConversionSuccessStatus("pixelorama", layeredProject)).toBe(
      "Converted supported Pixelorama frames and raster layers into an editable Aseprite timeline with 2 frames and 2 preserved layers. Ready to download.",
    );
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const error = new PixeloramaImportError(
      "unsupported-feature",
      "Pixelorama layer 1 uses unsupported blend mode 2.",
    );
    error.stack = "private-pixelorama-stack";

    expect(getConversionErrorMessage("pixelorama", error)).toBe(
      "Pixelorama import failed: Pixelorama layer 1 uses unsupported blend mode 2.",
    );
    expect(getConversionErrorMessage("pixelorama", error)).not.toContain(
      "private-pixelorama-stack",
    );
  });

  it("does not expose arbitrary Pixelorama errors", () => {
    const privateMessage = "private Pixelorama source details";

    const message = getConversionErrorMessage(
      "pixelorama",
      new Error(privateMessage),
    );

    expect(message).toBe(
      "Pixelorama import failed: Check that the .pxo file contains supported raster pixel layer data.",
    );
    expect(message).not.toContain(privateMessage);
  });
});

describe("OpenRaster conversion messages", () => {
  const layeredProject: SpriteProject = {
    ...project,
    layers: [
      project.layers[0],
      {
        id: "detail",
        name: "Detail",
        visible: true,
        opacity: 255,
        cels: [],
      },
    ],
  };

  it("reports supported raster layer data without overclaiming unsupported features", () => {
    expect(getConversionSuccessStatus("openraster", layeredProject)).toBe(
      "Converted supported OpenRaster raster layer data into an editable Aseprite timeline with 1 frame and 2 preserved layers. Ready to download.",
    );
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const error = new OpenRasterImportError(
      "unsupported-feature",
      "OpenRaster nested stacks and layer groups are unsupported.",
    );
    error.stack = "private-openraster-stack";

    expect(getConversionErrorMessage("openraster", error)).toBe(
      "OpenRaster import failed: OpenRaster nested stacks and layer groups are unsupported.",
    );
    expect(getConversionErrorMessage("openraster", error)).not.toContain(
      "private-openraster-stack",
    );
  });

  it("does not expose arbitrary OpenRaster errors", () => {
    const privateMessage = "private OpenRaster source details";

    const message = getConversionErrorMessage(
      "openraster",
      new Error(privateMessage),
    );

    expect(message).toBe(
      "OpenRaster import failed: Check that the .ora file contains supported normal PNG-backed raster layer data.",
    );
    expect(message).not.toContain(privateMessage);
  });
});

describe("GIF and APNG conversion messages", () => {
  const animatedProject: SpriteProject = {
    ...project,
    frames: [
      { index: 0, durationMs: 100 },
      { index: 1, durationMs: 80 },
    ],
  };

  it("includes the imported frame count in success messages", () => {
    expect(getConversionSuccessStatus("gif", animatedProject)).toBe(
      "Converted 2 GIF frames into an editable Aseprite timeline. Ready to download.",
    );
    expect(getConversionSuccessStatus("apng", animatedProject)).toBe(
      "Converted 2 APNG frames into an editable Aseprite timeline. Ready to download.",
    );
  });

  it("shows importer-authored diagnostics without exposing stack traces", () => {
    const gifError = new GifImportError("unsupported-version", "Only GIF89a files are supported.");
    gifError.stack = "private-gif-stack";
    const apngError = new ApngImportError("not-animated", "PNG does not contain APNG animation chunks.");
    apngError.stack = "private-apng-stack";

    expect(getConversionErrorMessage("gif", gifError)).toBe(
      "GIF import failed: Only GIF89a files are supported.",
    );
    expect(getConversionErrorMessage("apng", apngError)).toBe(
      "APNG import failed: PNG does not contain APNG animation chunks.",
    );
    expect(getConversionErrorMessage("gif", gifError)).not.toContain("stack");
    expect(getConversionErrorMessage("apng", apngError)).not.toContain("stack");
  });

  it("does not expose arbitrary GIF or APNG errors", () => {
    const privateMessage = "private source details";
    expect(getConversionErrorMessage("gif", new Error(privateMessage)))
      .not.toContain(privateMessage);
    expect(getConversionErrorMessage("apng", new Error(privateMessage)))
      .not.toContain(privateMessage);
  });
});

describe("Piskel conversion messages", () => {
  it("reports converted frames and preserved source layers", () => {
    expect(getConversionSuccessStatus("piskel", project)).toBe(
      "Converted 1 visible Piskel frame and preserved 1 layer in an editable Aseprite timeline. Ready to download.",
    );
  });

  it.each<[PiskelImportErrorCode, string]>([
    ["invalid-json", "Piskel file is not valid JSON."],
    ["unsupported-model-version", "Unsupported Piskel modelVersion; expected integer 2."],
    ["missing-field", "Piskel object.layers is required."],
    ["invalid-dimension", "Piskel object.width must be an integer from 1 to 1024."],
    ["invalid-fps", "Piskel object.fps must be a finite number greater than zero."],
    ["hidden-frames", "Piskel object.hiddenFrames contains a duplicate frame index."],
    ["legacy-layer-layout", "Piskel layer 1 cannot contain both chunks and a legacy base64PNG field."],
    ["invalid-layer-json", "Piskel layer 1 is not valid JSON."],
    ["missing-chunks", "Piskel layer 1 must contain chunks or a legacy base64PNG field."],
    ["invalid-chunk-layout", "Piskel layer 1, chunk 1.layout must be rectangular."],
    ["frame-coverage", "Piskel layer 1 frame coverage is incomplete."],
    ["invalid-png-data-url", "Piskel layer 1, chunk 1.base64PNG must be an embedded PNG data URL."],
    ["png-dimension-mismatch", "Piskel layer 1, chunk 1.base64PNG PNG dimensions must be 4x2."],
  ])("surfaces safe %s importer detail", (code, detail) => {
    const message = getConversionErrorMessage(
      "piskel",
      new PiskelImportError(code, detail),
    );

    expect(message).toBe(
      `The Piskel file failed validation: ${detail} ` +
        "Check that it is a supported model-version-2 .piskel file.",
    );
    expect(message).not.toContain("PiskelImportError");
  });

  it("reports browser image decode detail without a stack trace", () => {
    const detail = "Could not decode PNG for Piskel layer 1, chunk 1.";
    expect(
      getConversionErrorMessage(
        "piskel",
        new PiskelImportError("browser-image-decode", detail),
      ),
    ).toBe(
      `Could not decode an embedded Piskel layer image in this browser: ${detail} ` +
        "Check that the .piskel file is complete and try again.",
    );
  });

  it("reports invalid hiddenFrames precisely without exposing a stack trace", () => {
    const detail =
      "Piskel object.hiddenFrames must contain safe integer frame indexes or strict decimal index strings.";
    const error = new PiskelImportError("hidden-frames", detail);
    error.stack = `PiskelImportError: ${detail}\n    at parseVisibleFrameIndexes (private-source.ts:1:1)`;

    const message = getConversionErrorMessage("piskel", error);

    expect(message).toBe(
      `The Piskel file failed validation: ${detail} ` +
        "Check that it is a supported model-version-2 .piskel file.",
    );
    expect(message).not.toContain("parseVisibleFrameIndexes");
    expect(message).not.toContain("private-source.ts");
  });

  it("does not expose arbitrary thrown content as an importer diagnostic", () => {
    const privateContents = '{"private pixels":"do not display"}';

    const message = getConversionErrorMessage(
      "piskel",
      new Error(`Piskel object.width must be valid. ${privateContents}`),
    );
    expect(message).toBe(
      "Could not convert the Piskel file. " +
        "Check that it is a supported model-version-2 .piskel file.",
    );
    expect(message).not.toContain(privateContents);
  });
});

describe("spritesheet JSON conversion messages", () => {
  it("surfaces importer-authored format diagnostics without a stack trace", () => {
    const detail =
      "Phaser Multi-Atlas metadata is recognized but not supported because it contains nested atlas pages.";
    const error = new SpritesheetJsonImportError(
      "unsupported-variant",
      detail,
    );
    error.stack = `SpritesheetJsonImportError: ${detail}\n at private-atlas.json:1:1`;

    const message = getConversionErrorMessage("spritesheet-json", error);

    expect(message).toBe(detail);
    expect(message).not.toContain("private-atlas.json");
    expect(message).not.toContain("SpritesheetJsonImportError");
  });

  it("does not expose arbitrary atlas error content", () => {
    const privateContents = '{"privatePixelData":"do not display"}';

    const message = getConversionErrorMessage(
      "spritesheet-json",
      new Error(privateContents),
    );

    expect(message).toBe(
      "Could not convert the spritesheet atlas. " +
        "Check that the JSON uses a supported root-level frame layout.",
    );
    expect(message).not.toContain(privateContents);
  });
});
