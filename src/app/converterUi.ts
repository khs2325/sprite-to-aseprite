import "../styles.css";

import type { SpriteProject } from "../core/SpriteProject";
import { getApngImportDiagnostic, importApng } from "../core/importers/apng";
import { getGifImportDiagnostic, importGif } from "../core/importers/gif";
import {
  getKritaImportDiagnostic,
  importKrita,
} from "../core/importers/krita";
import {
  getOpenRasterImportDiagnostic,
  importOpenRaster,
} from "../core/importers/openraster";
import {
  getPixeloramaImportDiagnostic,
  importPixelorama,
} from "../core/importers/pixelorama";
import { importPngSequence } from "../core/importers/pngSequence";
import {
  getPsdParserDiagnostic,
  importPsd,
} from "../core/importers/psd";
import {
  getPiskelImportDiagnostic,
  importPiskel,
  PiskelImportError,
} from "../core/importers/piskel";
import {
  importSpritesheetGrid,
  type SpritesheetGridImportOptions,
} from "../core/importers/spritesheetGrid";
import {
  getSpritesheetJsonImportDiagnostic,
  importSpritesheetJson,
} from "../core/importers/spritesheetJson";
import { mountExportDownloadUi } from "./exportDownload";
import {
  bindFileImportControl,
  createSourcePreviewUrlStore,
  getSourceFilePresentation,
  SUPPORTED_SOURCE_ACCEPT,
  type BrowserSourceFile,
  type FileImportDependencies,
  type FileImportFormat,
} from "./fileImport";
import { mountLayerNamingUi } from "./layerNaming";
import {
  renderLargeFileWarning,
  type DecodedRgbaEstimate,
} from "./largeFileWarning";
import { mountPreviewTimelineUi } from "./previewTimeline";
import {
  createInformationalPages,
  createSiteNavigationLinks,
} from "./siteContent";
import {
  createSupportEntryPoint,
  createSupportFooter,
  createSupportSection,
  DEFAULT_SUPPORT_LINKS,
} from "./supportLinks";

type ConverterImporters = {
  importApng: typeof importApng;
  importGif: typeof importGif;
  importKrita: typeof importKrita;
  importOpenRaster: typeof importOpenRaster;
  importPixelorama: typeof importPixelorama;
  importPngSequence: typeof importPngSequence;
  importPsd: typeof importPsd;
  importPiskel: typeof importPiskel;
  importSpritesheetGrid: typeof importSpritesheetGrid;
  importSpritesheetJson: typeof importSpritesheetJson;
};

export type ConverterUi = {
  destroy(): void;
};

type ConversionUiElements = {
  activityControl: HTMLElement;
  progress: HTMLElement;
  status: HTMLElement;
  error: HTMLElement;
  sourceControls: readonly (
    | HTMLButtonElement
    | HTMLInputElement
    | HTMLSelectElement
  )[];
  dropZone: HTMLElement;
  convertButton: HTMLButtonElement;
};

export type ConversionUiState = {
  isWorking: boolean;
  canConvert: boolean;
  status: string;
  error?: string;
};

const DEFAULT_IMPORTERS: ConverterImporters = {
  importApng,
  importGif,
  importKrita,
  importOpenRaster,
  importPixelorama,
  importPngSequence,
  importPsd,
  importPiskel,
  importSpritesheetGrid,
  importSpritesheetJson,
};

export const MODE_LABELS: Record<FileImportFormat, string> = {
  "png-sequence": "PNG sequence",
  "spritesheet-grid": "Spritesheet grid",
  "spritesheet-json": "Spritesheet PNG + JSON",
  piskel: "Piskel project",
  gif: "GIF animation",
  apng: "APNG animation",
  openraster: "OpenRaster project",
  pixelorama: "Pixelorama project",
  krita: "Krita project",
  psd: "PSD project",
};

export function getImportDropInstructions(mode: FileImportFormat): string {
  if (mode === "piskel") {
    return "Drop exactly one .piskel file here, or choose one below.";
  }
  if (mode === "gif") {
    return "Drop exactly one .gif file here, or choose one below.";
  }
  if (mode === "apng") {
    return "Drop exactly one .apng or animated .png file here, or choose one below.";
  }
  if (mode === "openraster") {
    return "Drop exactly one .ora file with supported raster layer data here, or choose one below.";
  }
  if (mode === "pixelorama") {
    return "Drop exactly one .pxo file here. Supported frames and layers are preserved only when the source contains supported raster pixel data.";
  }
  if (mode === "krita") {
    return "Drop exactly one .kra file from the documented minimal raster subset here, or choose one below.";
  }
  if (mode === "psd") {
    return "Drop exactly one .psd file from the RGB 8-bit raster-layer subset here, or choose one below.";
  }
  return "Drag and drop PNG, JSON, Piskel, GIF, APNG, OpenRaster, Pixelorama, Krita, or PSD files here, or choose files below.";
}

export type GridAutoCalculation = {
  columns: number | null;
  rows: number | null;
  warning: string | null;
};

export type FrameAutoCalculation = {
  frameHeight: number | null;
  frameWidth: number | null;
  warning: string | null;
};

export type GridUpdateSource =
  | "frame-size"
  | "grid-size"
  | "image-change"
  | "manual";

export type GridUpdateGuard = {
  run(source: GridUpdateSource, update: () => void): boolean;
};

export type ExactFitGridCalculation = {
  message: string;
  values: {
    columns: number;
    frameHeight: number;
    frameWidth: number;
    rows: number;
  } | null;
};

export type GridPreviewState = {
  canConvert: boolean;
  description: string;
  details: {
    frameSize: string;
    gridSize: string;
    imageSize: string;
    totalFrames: string;
  };
  warning: string | null;
};

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function createGridUpdateGuard(): GridUpdateGuard {
  let activeSource: GridUpdateSource | null = null;
  return {
    run(source: GridUpdateSource, update: () => void): boolean {
      if (activeSource !== null) {
        return false;
      }
      activeSource = source;
      try {
        update();
      } finally {
        activeSource = null;
      }
      return true;
    },
  };
}

export function findNearestDivisor(
  dimension: number,
  desiredCount: number,
): number | null {
  if (!isPositiveInteger(dimension) || !Number.isFinite(desiredCount) || desiredCount <= 0) {
    return null;
  }

  let nearest = 1;
  let nearestDistance = Math.abs(desiredCount - 1);
  const consider = (divisor: number): void => {
    const distance = Math.abs(desiredCount - divisor);
    // A larger divisor means a smaller frame. Prefer it on an exact tie.
    if (distance < nearestDistance || (distance === nearestDistance && divisor > nearest)) {
      nearest = divisor;
      nearestDistance = distance;
    }
  };

  for (let divisor = 1; divisor * divisor <= dimension; divisor += 1) {
    if (dimension % divisor === 0) {
      consider(divisor);
      consider(dimension / divisor);
    }
  }
  return nearest;
}

export function calculateExactFitGrid(
  imageWidth: number,
  imageHeight: number,
  options: SpritesheetGridImportOptions,
  source: GridUpdateSource,
): ExactFitGridCalculation {
  if (!isPositiveInteger(imageWidth) || !isPositiveInteger(imageHeight)) {
    return {
      message: "Enter a valid frame size or grid size to calculate an exact-fit grid.",
      values: null,
    };
  }

  const useGridSize = source === "grid-size";
  const horizontalInput = useGridSize
    ? options.columns
    : imageWidth / options.frameWidth;
  const verticalInput = useGridSize ? options.rows : imageHeight / options.frameHeight;
  if (
    (useGridSize &&
      (!isPositiveInteger(options.columns) || !isPositiveInteger(options.rows))) ||
    (!useGridSize &&
      (!isPositiveInteger(options.frameWidth) ||
        !isPositiveInteger(options.frameHeight)))
  ) {
    return {
      message: "Enter a valid frame size or grid size to calculate an exact-fit grid.",
      values: null,
    };
  }

  const columns = findNearestDivisor(imageWidth, horizontalInput);
  const rows = findNearestDivisor(imageHeight, verticalInput);
  if (
    columns === null ||
    rows === null ||
    !Number.isSafeInteger(columns * rows)
  ) {
    return {
      message: "Enter a valid frame size or grid size to calculate an exact-fit grid.",
      values: null,
    };
  }

  const values = {
    columns,
    frameHeight: imageHeight / rows,
    frameWidth: imageWidth / columns,
    rows,
  };
  const adjusted =
    values.columns !== options.columns ||
    values.rows !== options.rows ||
    values.frameWidth !== options.frameWidth ||
    values.frameHeight !== options.frameHeight;
  const prefix = adjusted ? "Adjusted to exact fit" : "Exact fit";
  return {
    message:
      `${prefix}: ${values.columns} columns × ${values.rows} rows, ` +
      `${values.frameWidth} × ${values.frameHeight} px each.`,
    values,
  };
}

export function calculateGridFromImage(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): GridAutoCalculation {
  if (!isPositiveInteger(frameWidth) || !isPositiveInteger(frameHeight)) {
    return {
      columns: null,
      rows: null,
      warning: "Frame width and frame height must be positive whole numbers.",
    };
  }

  const columns = findNearestDivisor(imageWidth, imageWidth / frameWidth);
  const rows = findNearestDivisor(imageHeight, imageHeight / frameHeight);
  if (columns === null || rows === null) {
    return {
      columns: null,
      rows: null,
      warning: "Enter a valid frame size or grid size to calculate an exact-fit grid.",
    };
  }
  return { columns, rows, warning: null };
}

export function calculateFrameSizeFromGrid(
  imageWidth: number,
  imageHeight: number,
  columns: number,
  rows: number,
): FrameAutoCalculation {
  if (!isPositiveInteger(columns) || !isPositiveInteger(rows)) {
    return {
      frameHeight: null,
      frameWidth: null,
      warning: "Columns and rows must be positive whole numbers.",
    };
  }

  const snappedColumns = findNearestDivisor(imageWidth, columns);
  const snappedRows = findNearestDivisor(imageHeight, rows);
  if (snappedColumns === null || snappedRows === null) {
    return {
      frameHeight: null,
      frameWidth: null,
      warning: "Enter a valid frame size or grid size to calculate an exact-fit grid.",
    };
  }
  return {
    frameHeight: imageHeight / snappedRows,
    frameWidth: imageWidth / snappedColumns,
    warning: null,
  };
}

export function getGridPreviewState(
  imageWidth: number,
  imageHeight: number,
  options: SpritesheetGridImportOptions,
): GridPreviewState {
  const details = {
    frameSize: `Frame size: ${options.frameWidth} × ${options.frameHeight} px`,
    gridSize: `Grid: ${options.columns} columns × ${options.rows} rows`,
    imageSize: `Image size: ${imageWidth} × ${imageHeight} px`,
    totalFrames: `Total frames: ${options.columns * options.rows}`,
  };
  const values = [
    options.frameWidth,
    options.frameHeight,
    options.rows,
    options.columns,
  ];
  if (
    !values.every(isPositiveInteger) ||
    !Number.isSafeInteger(options.columns * options.rows)
  ) {
    return {
      canConvert: false,
      description:
        "Grid preview unavailable: choose one PNG and enter valid grid settings.",
      details,
      warning: "Frame width, frame height, rows, and columns must be positive whole numbers.",
    };
  }

  const description =
    `Grid preview: ${options.columns} columns × ${options.rows} rows, ` +
    `${options.columns * options.rows} frames, ` +
    `${options.frameWidth} × ${options.frameHeight} px each.`;
  const gridWidth = options.frameWidth * options.columns;
  const gridHeight = options.frameHeight * options.rows;
  if (gridWidth > imageWidth || gridHeight > imageHeight) {
    return {
      canConvert: false,
      description,
      details,
      warning: "The configured grid exceeds the selected image dimensions.",
    };
  }
  if (gridWidth !== imageWidth || gridHeight !== imageHeight) {
    return {
      canConvert: false,
      description,
      details,
      warning: "The configured rows and columns do not cover the complete image.",
    };
  }
  return { canConvert: true, description, details, warning: null };
}

export function getSourceSelectionState(
  mode: FileImportFormat,
  files: readonly BrowserSourceFile[],
): { canConvert: boolean; error: string | null; status: string } {
  if (files.length === 0) {
    return {
      canConvert: false,
      error: null,
      status: "Choose source files to begin.",
    };
  }
  const error = getSourceSelectionError(mode, files);
  return {
    canConvert: error === null,
    error,
    status:
      error === null
        ? "Source files are ready to convert."
        : "Adjust the selected files for the current import mode.",
  };
}

export function renderConversionState(
  elements: ConversionUiElements,
  state: ConversionUiState,
): void {
  elements.activityControl.setAttribute("aria-busy", String(state.isWorking));
  elements.progress.hidden = !state.isWorking;
  elements.status.textContent = state.status;
  elements.error.textContent = state.error ?? "";
  elements.error.hidden = state.error === undefined;
  elements.convertButton.disabled = state.isWorking || !state.canConvert;
  elements.dropZone.inert = state.isWorking;
  elements.dropZone.setAttribute("aria-disabled", String(state.isWorking));
  for (const control of elements.sourceControls) {
    control.disabled = state.isWorking;
  }
}

export function getSourceSelectionError(
  mode: FileImportFormat,
  files: readonly BrowserSourceFile[],
): string | null {
  const pngCount = files.filter((file) => file.kind === "png").length;
  const jsonCount = files.filter((file) => file.kind === "json").length;
  const piskelCount = files.filter((file) => file.kind === "piskel").length;
  const gifCount = files.filter((file) => file.kind === "gif").length;
  const apngCount = files.filter((file) => file.kind === "apng").length;
  const openRasterCount = files.filter((file) => file.kind === "ora").length;
  const pixeloramaCount = files.filter((file) => file.kind === "pxo").length;
  const kritaCount = files.filter((file) => file.kind === "kra").length;
  const psdCount = files.filter((file) => file.kind === "psd").length;

  if (mode === "png-sequence") {
    return pngCount > 0 && pngCount === files.length
      ? null
      : "PNG sequence mode requires one or more PNG files only.";
  }
  if (mode === "spritesheet-grid") {
    return pngCount === 1 && files.length === 1
      ? null
      : "Spritesheet grid mode requires exactly one PNG file.";
  }
  if (mode === "spritesheet-json") {
    return pngCount === 1 && jsonCount === 1 && files.length === 2
      ? null
      : "Spritesheet PNG + JSON mode requires exactly one PNG and one JSON file.";
  }
  if (mode === "piskel") {
    return piskelCount === 1 && files.length === 1
      ? null
      : "Piskel mode requires exactly one .piskel file.";
  }
  if (mode === "gif") {
    return gifCount === 1 && files.length === 1
      ? null
      : "GIF mode requires exactly one .gif file.";
  }
  if (mode === "openraster") {
    return openRasterCount === 1 && files.length === 1
      ? null
      : "OpenRaster mode requires exactly one .ora file.";
  }
  if (mode === "pixelorama") {
    return pixeloramaCount === 1 && files.length === 1
      ? null
      : "Pixelorama mode requires exactly one .pxo file.";
  }
  if (mode === "krita") {
    return kritaCount === 1 && files.length === 1
      ? null
      : "Krita mode requires exactly one .kra file.";
  }
  if (mode === "psd") {
    return psdCount === 1 && files.length === 1
      ? null
      : "PSD mode requires exactly one .psd file.";
  }
  return files.length === 1 && apngCount + pngCount === 1
    ? null
    : "APNG mode requires exactly one .apng or APNG-compatible .png file.";
}

export async function convertSourceFiles(
  mode: FileImportFormat,
  files: readonly BrowserSourceFile[],
  gridOptions: SpritesheetGridImportOptions,
  importers: ConverterImporters = DEFAULT_IMPORTERS,
): Promise<SpriteProject> {
  const selectionError = getSourceSelectionError(mode, files);
  if (selectionError !== null) {
    throw new Error(selectionError);
  }

  const pngFiles = files
    .filter((file) => file.kind === "png")
    .map((file) => file.file);

  if (mode === "png-sequence") {
    return importers.importPngSequence(pngFiles);
  }
  if (mode === "spritesheet-grid") {
    return importers.importSpritesheetGrid(pngFiles[0], gridOptions);
  }
  if (mode === "piskel") {
    const piskelFile = files.find((file) => file.kind === "piskel");
    if (piskelFile === undefined) {
      throw new Error("Piskel source file is missing.");
    }
    return importers.importPiskel(piskelFile.file);
  }
  if (mode === "gif") {
    const gifFile = files.find((file) => file.kind === "gif");
    if (gifFile === undefined) {
      throw new Error("GIF source file is missing.");
    }
    return importers.importGif(gifFile.file);
  }
  if (mode === "apng") {
    const apngFile = files.find(
      (file) => file.kind === "apng" || file.kind === "png",
    );
    if (apngFile === undefined) {
      throw new Error("APNG source file is missing.");
    }
    return importers.importApng(apngFile.file);
  }
  if (mode === "openraster") {
    const openRasterFile = files.find((file) => file.kind === "ora");
    if (openRasterFile === undefined) {
      throw new Error("OpenRaster source file is missing.");
    }
    return importers.importOpenRaster(openRasterFile.file);
  }
  if (mode === "pixelorama") {
    const pixeloramaFile = files.find((file) => file.kind === "pxo");
    if (pixeloramaFile === undefined) {
      throw new Error("Pixelorama source file is missing.");
    }
    return importers.importPixelorama(pixeloramaFile.file);
  }
  if (mode === "krita") {
    const kritaFile = files.find((file) => file.kind === "kra");
    if (kritaFile === undefined) {
      throw new Error("Krita source file is missing.");
    }
    return importers.importKrita(kritaFile.file);
  }
  if (mode === "psd") {
    const psdFile = files.find((file) => file.kind === "psd");
    if (psdFile === undefined) {
      throw new Error("PSD source file is missing.");
    }
    return importers.importPsd(psdFile.file);
  }

  const jsonFile = files.find((file) => file.kind === "json");
  if (jsonFile === undefined) {
    throw new Error("Spritesheet JSON metadata is missing.");
  }
  return importers.importSpritesheetJson(pngFiles[0], jsonFile.file);
}

export function getConversionSuccessStatus(
  mode: FileImportFormat,
  project: Pick<SpriteProject, "frames" | "layers">,
): string {
  const frameCount = project.frames.length;
  const frameNoun = frameCount === 1 ? "frame" : "frames";
  if (mode === "piskel") {
    const layerCount = project.layers.length;
    const layerNoun = layerCount === 1 ? "layer" : "layers";
    return (
      `Converted ${frameCount} visible Piskel ${frameNoun} and preserved ${layerCount} ${layerNoun} ` +
      "in an editable Aseprite timeline. Ready to download."
    );
  }
  if (mode === "gif" || mode === "apng") {
    const formatLabel = mode === "gif" ? "GIF" : "APNG";
    return (
      `Converted ${frameCount} ${formatLabel} ${frameNoun} ` +
      "into an editable Aseprite timeline. Ready to download."
    );
  }
  if (mode === "openraster") {
    const layerCount = project.layers.length;
    const layerNoun = layerCount === 1 ? "layer" : "layers";
    return (
      "Converted supported OpenRaster raster layer data " +
      `into an editable Aseprite timeline with ${frameCount} ${frameNoun} ` +
      `and ${layerCount} preserved ${layerNoun}. Ready to download.`
    );
  }
  if (mode === "pixelorama") {
    const layerCount = project.layers.length;
    const layerNoun = layerCount === 1 ? "layer" : "layers";
    return (
      "Converted supported Pixelorama frames and raster layers " +
      `into an editable Aseprite timeline with ${frameCount} ${frameNoun} ` +
      `and ${layerCount} preserved ${layerNoun}. Ready to download.`
    );
  }
  if (mode === "krita") {
    const layerCount = project.layers.length;
    const layerNoun = layerCount === 1 ? "layer" : "layers";
    return (
      "Converted supported Krita raster layers and frame data " +
      `into an editable Aseprite timeline with ${frameCount} ${frameNoun} ` +
      `and ${layerCount} preserved ${layerNoun}. Ready to download.`
    );
  }
  if (mode === "psd") {
    const layerCount = project.layers.length;
    const layerNoun = layerCount === 1 ? "layer" : "layers";
    return (
      "Converted supported PSD RGB 8-bit raster layers " +
      `into an editable Aseprite timeline with ${frameCount} ${frameNoun} ` +
      `and ${layerCount} preserved ${layerNoun}. Ready to download.`
    );
  }
  return (
    `Converted ${frameCount} ${frameNoun} ` +
    "into an editable Aseprite timeline. Ready to download."
  );
}

export function getConversionErrorMessage(
  mode: FileImportFormat,
  error: unknown,
): string {
  if (mode === "spritesheet-json") {
    return getSpritesheetJsonImportDiagnostic(error) ??
      "Could not convert the spritesheet atlas. Check that the JSON uses a supported root-level frame layout.";
  }
  if (mode === "gif") {
    const diagnostic = getGifImportDiagnostic(error);
    return diagnostic === null
      ? "GIF import failed: Check that the file uses the supported GIF subset."
      : `GIF import failed: ${diagnostic}`;
  }
  if (mode === "apng") {
    const diagnostic = getApngImportDiagnostic(error);
    return diagnostic === null
      ? "APNG import failed: Check that the file uses the supported APNG subset."
      : `APNG import failed: ${diagnostic}`;
  }
  if (mode === "openraster") {
    const diagnostic = getOpenRasterImportDiagnostic(error);
    return diagnostic === null
      ? "OpenRaster import failed: Check that the .ora file contains supported normal PNG-backed raster layer data."
      : `OpenRaster import failed: ${diagnostic}`;
  }
  if (mode === "pixelorama") {
    const diagnostic = getPixeloramaImportDiagnostic(error);
    return diagnostic === null
      ? "Pixelorama import failed: Check that the .pxo file contains supported raster pixel layer data."
      : `Pixelorama import failed: ${diagnostic}`;
  }
  if (mode === "krita") {
    const diagnostic = getKritaImportDiagnostic(error);
    return diagnostic === null
      ? "Krita import failed: Check that the .kra file contains supported 8-bit RGBA paint layers from the documented minimal raster subset."
      : `Krita import failed: ${diagnostic}`;
  }
  if (mode === "psd") {
    const diagnostic = getPsdParserDiagnostic(error);
    return diagnostic === null
      ? "PSD import failed: Check that the .psd file contains supported RGB 8-bit raster layers from the documented subset."
      : `PSD import failed: ${diagnostic}`;
  }
  if (mode !== "piskel") {
    return error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Could not convert the selected files.";
  }

  const diagnostic = getPiskelImportDiagnostic(error);
  if (diagnostic === null) {
    return (
      "Could not convert the Piskel file. " +
      "Check that it is a supported model-version-2 .piskel file."
    );
  }
  if (
    error instanceof PiskelImportError &&
    error.code === "browser-image-decode"
  ) {
    return (
      `Could not decode an embedded Piskel layer image in this browser: ${diagnostic} ` +
      "Check that the .piskel file is complete and try again."
    );
  }
  return (
    `The Piskel file failed validation: ${diagnostic} ` +
    "Check that it is a supported model-version-2 .piskel file."
  );
}

function createNumberInput(
  document: Document,
  labelText: string,
  value: string,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  const input = document.createElement("input");
  label.textContent = labelText;
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.required = true;
  input.value = value;
  label.append(input);
  return { label, input };
}

export function mountConverterUi(root: HTMLElement): ConverterUi {
  const document = root.ownerDocument;
  root.replaceChildren();

  const header = document.createElement("header");
  const siteNav = document.createElement("nav");
  const title = document.createElement("h1");
  const introduction = document.createElement("p");
  const privacy = document.createElement("p");
  siteNav.setAttribute("aria-label", "Site links");
  siteNav.append(
    ...createSiteNavigationLinks(document),
    createSupportEntryPoint(document),
  );
  title.textContent = "Sprite to Aseprite Converter";
  introduction.textContent =
    "Convert frames into an editable Aseprite timeline from PNG sequences, spritesheets, Piskel projects, OpenRaster projects, Pixelorama projects, Krita projects, PSD raster-layer projects, and GIF/APNG animations.";
  privacy.textContent =
    "Files are processed browser-locally. Your artwork is never uploaded.";
  privacy.className = "privacy-notice";
  header.append(siteNav, title, introduction, privacy);

  const controls = document.createElement("section");
  const controlsHeading = document.createElement("h2");
  const modeLabel = document.createElement("label");
  const modeSelect = document.createElement("select");
  controls.className = "panel";
  controlsHeading.textContent = "1. Choose an import mode";
  modeLabel.textContent = "Import mode";
  for (const [value, label] of Object.entries(MODE_LABELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modeSelect.append(option);
  }
  modeLabel.append(modeSelect);

  const gridFields = document.createElement("fieldset");
  const gridLegend = document.createElement("legend");
  const frameWidth = createNumberInput(document, "Frame width", "32");
  const frameHeight = createNumberInput(document, "Frame height", "32");
  const rows = createNumberInput(document, "Rows", "1");
  const columns = createNumberInput(document, "Columns", "1");
  const frameOrderLabel = document.createElement("label");
  const frameOrder = document.createElement("select");
  const rowMajor = document.createElement("option");
  const columnMajor = document.createElement("option");
  gridFields.className = "grid-options";
  gridLegend.textContent = "Grid settings";
  frameOrderLabel.textContent = "Frame order";
  rowMajor.value = "row-major";
  rowMajor.textContent = "Rows first";
  columnMajor.value = "column-major";
  columnMajor.textContent = "Columns first";
  frameOrder.append(rowMajor, columnMajor);
  frameOrderLabel.append(frameOrder);
  gridFields.append(
    gridLegend,
    frameWidth.label,
    frameHeight.label,
    rows.label,
    columns.label,
    frameOrderLabel,
  );

  const gridPreview = document.createElement("section");
  const gridPreviewHeading = document.createElement("h3");
  const gridPreviewFrame = document.createElement("div");
  const gridPreviewImage = document.createElement("img");
  const gridOverlay = document.createElement("div");
  const gridPreviewStatus = document.createElement("p");
  const gridPreviewDetails = document.createElement("div");
  const gridImageSize = document.createElement("p");
  const gridSize = document.createElement("p");
  const gridFrameSize = document.createElement("p");
  const gridTotalFrames = document.createElement("p");
  const gridExactFitStatus = document.createElement("p");
  const gridPreviewWarning = document.createElement("p");
  gridPreview.className = "grid-preview";
  gridPreviewHeading.textContent = "Grid overlay preview";
  gridPreviewFrame.className = "grid-preview-frame";
  gridPreviewImage.alt = "Selected spritesheet preview";
  gridOverlay.className = "grid-overlay";
  gridOverlay.setAttribute("aria-hidden", "true");
  gridPreviewStatus.setAttribute("role", "status");
  gridPreviewStatus.setAttribute("aria-live", "polite");
  gridPreviewDetails.className = "grid-preview-details";
  gridPreviewDetails.append(
    gridImageSize,
    gridSize,
    gridFrameSize,
    gridTotalFrames,
  );
  gridExactFitStatus.className = "grid-fit-status";
  gridExactFitStatus.setAttribute("role", "status");
  gridExactFitStatus.setAttribute("aria-live", "polite");
  gridPreviewWarning.className = "grid-warning";
  gridPreviewWarning.setAttribute("role", "status");
  gridPreviewWarning.setAttribute("aria-live", "polite");
  gridPreviewFrame.append(gridPreviewImage, gridOverlay);
  gridPreview.append(
    gridPreviewHeading,
    gridPreviewFrame,
    gridPreviewStatus,
    gridPreviewDetails,
    gridExactFitStatus,
    gridPreviewWarning,
  );
  controls.append(controlsHeading, modeLabel, gridFields, gridPreview);

  const importPanel = document.createElement("section");
  const importHeading = document.createElement("h2");
  const dropZone = document.createElement("div");
  const dropInstructions = document.createElement("p");
  const fileInput = document.createElement("input");
  const sourceError = document.createElement("p");
  const sourceStatus = document.createElement("p");
  const memoryWarning = document.createElement("p");
  const selectedFilesSection = document.createElement("section");
  const selectedFilesHeading = document.createElement("h3");
  const selectedFileList = document.createElement("ul");
  const clearFilesButton = document.createElement("button");
  importPanel.className = "panel";
  importHeading.textContent = "2. Add source files";
  dropZone.className = "drop-zone";
  dropInstructions.textContent =
    getImportDropInstructions("png-sequence");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = SUPPORTED_SOURCE_ACCEPT;
  fileInput.setAttribute(
    "aria-label",
    "Choose PNG, JSON, Piskel, GIF, APNG, OpenRaster, Pixelorama, Krita, or PSD sprite source files",
  );
  sourceError.setAttribute("role", "alert");
  sourceError.setAttribute("aria-live", "assertive");
  sourceStatus.setAttribute("role", "status");
  sourceStatus.setAttribute("aria-live", "polite");
  memoryWarning.className = "memory-warning";
  memoryWarning.setAttribute("role", "status");
  memoryWarning.setAttribute("aria-live", "polite");
  memoryWarning.hidden = true;
  selectedFilesSection.className = "selected-files";
  selectedFilesSection.setAttribute("aria-label", "Selected source files");
  selectedFilesHeading.textContent = "Selected files";
  selectedFileList.className = "selected-file-list";
  clearFilesButton.type = "button";
  clearFilesButton.textContent = "Clear selected files";
  selectedFilesSection.append(
    selectedFilesHeading,
    selectedFileList,
    clearFilesButton,
  );
  dropZone.append(dropInstructions, fileInput);
  importPanel.append(
    importHeading,
    dropZone,
    selectedFilesSection,
    sourceError,
    sourceStatus,
    memoryWarning,
  );

  const convertPanel = document.createElement("section");
  const convertHeading = document.createElement("h2");
  const convertButton = document.createElement("button");
  const conversionProgress = document.createElement("progress");
  const conversionStatus = document.createElement("p");
  const conversionError = document.createElement("p");
  convertPanel.className = "panel";
  convertHeading.textContent = "3. Convert and download";
  convertButton.type = "button";
  convertButton.textContent = "Convert to .aseprite";
  convertButton.disabled = true;
  conversionProgress.className = "conversion-progress";
  conversionProgress.setAttribute("aria-label", "Conversion progress");
  conversionProgress.hidden = true;
  conversionStatus.id = "conversion-status";
  conversionStatus.setAttribute("role", "status");
  conversionStatus.setAttribute("aria-live", "polite");
  conversionStatus.textContent = "Choose source files to begin.";
  conversionError.setAttribute("role", "alert");
  conversionError.setAttribute("aria-live", "assertive");
  conversionError.hidden = true;
  convertButton.setAttribute("aria-describedby", conversionStatus.id);
  convertPanel.append(
    convertHeading,
    convertButton,
    conversionProgress,
    conversionStatus,
    conversionError,
  );

  const workspace = document.createElement("div");
  const previewContainer = document.createElement("div");
  const layerContainer = document.createElement("div");
  const exportContainer = document.createElement("div");
  const supportSection = createSupportSection(document, DEFAULT_SUPPORT_LINKS);
  const informationalPages = createInformationalPages(document);
  const footer = createSupportFooter(document);
  workspace.className = "workspace";
  previewContainer.className = "panel";
  layerContainer.className = "panel";
  exportContainer.className = "download-area";
  workspace.append(previewContainer, layerContainer);
  convertPanel.append(exportContainer);
  root.append(
    header,
    controls,
    importPanel,
    convertPanel,
    workspace,
    supportSection,
    informationalPages,
    footer,
  );

  let mode: FileImportFormat = "png-sequence";
  let selectedFiles: readonly BrowserSourceFile[] = [];
  let conversionRequest = 0;
  let isConverting = false;
  let gridSourceFile: File | null = null;
  let gridImageWidth: number | null = null;
  let gridImageHeight: number | null = null;
  let gridImageError: string | null = null;
  let gridFitMessage = "";
  let gridFitIsError = false;
  const gridUpdateGuard = createGridUpdateGuard();
  const previewUrls = createSourcePreviewUrlStore();

  const conversionElements: ConversionUiElements = {
    activityControl: convertButton,
    progress: conversionProgress,
    status: conversionStatus,
    error: conversionError,
    sourceControls: [
      modeSelect,
      fileInput,
      frameWidth.input,
      frameHeight.input,
      rows.input,
      columns.input,
      frameOrder,
      clearFilesButton,
    ],
    dropZone,
    convertButton,
  };

  const exportUi = mountExportDownloadUi(exportContainer);
  exportUi.element.hidden = true;

  const syncProject = (project: SpriteProject | null): void => {
    previewUi.setProject(project);
    layerUi.setProject(project);
    exportUi.setProject(project);
    exportUi.element.hidden = project === null;
  };

  const previewUi = mountPreviewTimelineUi(previewContainer, {
    onProjectChange(project): void {
      layerUi.setProject(project);
      exportUi.setProject(project);
    },
  });
  const layerUi = mountLayerNamingUi(layerContainer, {
    onProjectChange(project): void {
      previewUi.setProject(project);
      exportUi.setProject(project);
    },
  });

  const invalidateConversion = (): void => {
    conversionRequest += 1;
    isConverting = false;
    syncProject(null);
  };

  const readGridOptions = (): SpritesheetGridImportOptions => ({
    frameWidth: Number(frameWidth.input.value),
    frameHeight: Number(frameHeight.input.value),
    rows: Number(rows.input.value),
    columns: Number(columns.input.value),
    frameOrder: frameOrder.value as "row-major" | "column-major",
  });

  const getSingleSelectedPng = (): BrowserSourceFile | null =>
    selectedFiles.length === 1 && selectedFiles[0].kind === "png"
      ? selectedFiles[0]
      : null;

  const getDecodedRgbaEstimate = (): DecodedRgbaEstimate | null => {
    if (
      mode !== "spritesheet-grid" ||
      gridImageWidth === null ||
      gridImageHeight === null
    ) {
      return null;
    }

    const options = readGridOptions();
    const frameCount = options.columns * options.rows;
    const sourcePixelCount = gridImageWidth * gridImageHeight;
    const framePixelCount =
      options.frameWidth * options.frameHeight * frameCount;
    if (
      isPositiveInteger(options.frameWidth) &&
      isPositiveInteger(options.frameHeight) &&
      isPositiveInteger(options.columns) &&
      isPositiveInteger(options.rows) &&
      Number.isSafeInteger(frameCount) &&
      Number.isSafeInteger(framePixelCount) &&
      framePixelCount >= sourcePixelCount
    ) {
      return {
        width: options.frameWidth,
        height: options.frameHeight,
        frames: frameCount,
      };
    }

    return {
      width: gridImageWidth,
      height: gridImageHeight,
    };
  };

  const renderSelectedFiles = (): void => {
    const pngFiles = selectedFiles
      .filter((source) => source.kind === "png" && mode !== "apng")
      .map((source) => source.file);
    previewUrls.retain(pngFiles);
    selectedFileList.replaceChildren();
    selectedFilesSection.hidden = selectedFiles.length === 0;

    selectedFiles.forEach((source, index) => {
      const presentation = getSourceFilePresentation(source, mode);
      const item = document.createElement("li");
      const visual =
        source.kind === "png" && mode !== "apng"
          ? document.createElement("img")
          : document.createElement("span");
      const details = document.createElement("div");
      const name = document.createElement("strong");
      const metadata = document.createElement("span");
      const removeButton = document.createElement("button");

      item.className = "selected-file-card";
      if (visual instanceof HTMLImageElement) {
        visual.className = "selected-file-thumbnail";
        visual.src = previewUrls.get(source.file);
        visual.alt = `Thumbnail preview of ${presentation.fileName}`;
      } else {
        visual.className = `selected-file-icon selected-file-icon-${source.kind}`;
        visual.textContent =
          source.kind === "png" ? "APNG" : source.kind.toUpperCase();
        visual.setAttribute("aria-hidden", "true");
      }
      details.className = "selected-file-details";
      name.textContent = presentation.fileName;
      metadata.textContent = `${presentation.typeLabel} · ${presentation.fileSize}`;
      removeButton.type = "button";
      removeButton.textContent = `Remove ${presentation.fileName}`;
      removeButton.addEventListener("click", () => {
        if (!isConverting) {
          applySelectedFiles(
            selectedFiles.filter((_, fileIndex) => fileIndex !== index),
          );
        }
      });
      details.append(name, metadata);
      item.append(visual, details, removeButton);
      selectedFileList.append(item);
    });
  };

  const renderGridPreview = (): GridPreviewState | null => {
    const source = getSingleSelectedPng();
    gridPreview.hidden = mode !== "spritesheet-grid" || source === null;
    if (mode !== "spritesheet-grid" || source === null) {
      gridPreviewStatus.textContent = "";
      gridImageSize.textContent = "";
      gridSize.textContent = "";
      gridFrameSize.textContent = "";
      gridTotalFrames.textContent = "";
      gridExactFitStatus.textContent = "";
      gridPreviewWarning.textContent = "";
      gridPreviewWarning.hidden = true;
      return null;
    }

    if (gridImageWidth === null || gridImageHeight === null) {
      gridPreviewStatus.textContent =
        gridImageError === null
          ? "Reading the selected spritesheet dimensions browser-locally."
          : "Grid preview is unavailable for the selected PNG.";
      gridImageSize.textContent = "";
      gridSize.textContent = "";
      gridFrameSize.textContent = "";
      gridTotalFrames.textContent = "";
      gridExactFitStatus.textContent = "";
      gridPreviewWarning.textContent = gridImageError ?? "";
      gridPreviewWarning.hidden = gridImageError === null;
      return null;
    }

    const options = readGridOptions();
    const previewState = getGridPreviewState(
      gridImageWidth,
      gridImageHeight,
      options,
    );
    gridPreviewStatus.textContent = previewState.description;
    gridImageSize.textContent = previewState.details.imageSize;
    gridSize.textContent = previewState.details.gridSize;
    gridFrameSize.textContent = previewState.details.frameSize;
    gridTotalFrames.textContent = previewState.details.totalFrames;
    gridExactFitStatus.textContent = gridFitMessage;
    gridExactFitStatus.className = gridFitIsError
      ? "grid-fit-status grid-fit-status-error"
      : "grid-fit-status";
    gridPreviewWarning.textContent = previewState.warning ?? "";
    gridPreviewWarning.hidden = previewState.warning === null;
    if (isPositiveInteger(options.columns) && isPositiveInteger(options.rows)) {
      gridOverlay.style.backgroundSize =
        `${100 / options.columns}% ${100 / options.rows}%`;
    } else {
      gridOverlay.style.backgroundSize = "";
    }
    return previewState;
  };

  const updateReadiness = (): void => {
    const sourceState = getSourceSelectionState(mode, selectedFiles);
    let canConvert = sourceState.canConvert;
    let status = sourceState.status;
    if (mode === "spritesheet-grid" && sourceState.canConvert) {
      const gridState = renderGridPreview();
      canConvert = gridState?.canConvert ?? false;
      status = canConvert
        ? "Source files and grid settings are ready to convert."
        : "Review the spritesheet dimensions and grid settings before converting.";
    }

    sourceError.textContent = sourceState.error ?? "";
    sourceError.hidden = sourceState.error === null;
    sourceStatus.textContent =
      selectedFiles.length === 0
        ? ""
        : `Selected ${selectedFiles.length} supported ${selectedFiles.length === 1 ? "file" : "files"}.`;
    sourceStatus.hidden = selectedFiles.length === 0;
    renderLargeFileWarning(
      memoryWarning,
      mode,
      selectedFiles.map(({ file }) => file),
      { decodedRgbaEstimate: getDecodedRgbaEstimate() },
    );
    renderConversionState(conversionElements, {
      isWorking: false,
      canConvert,
      status,
    });
  };

  const synchronizeGridInputs = (source: GridUpdateSource): boolean => {
    if (gridImageWidth === null || gridImageHeight === null) {
      return false;
    }
    return gridUpdateGuard.run(source, () => {
      const calculation = calculateExactFitGrid(
        gridImageWidth!,
        gridImageHeight!,
        readGridOptions(),
        source,
      );
      gridFitMessage = calculation.message;
      gridFitIsError = calculation.values === null;
      if (calculation.values !== null) {
        columns.input.value = String(calculation.values.columns);
        rows.input.value = String(calculation.values.rows);
        frameWidth.input.value = String(calculation.values.frameWidth);
        frameHeight.input.value = String(calculation.values.frameHeight);
      }
    });
  };

  const syncGridSource = (): void => {
    if (mode !== "spritesheet-grid") {
      gridPreview.hidden = true;
      return;
    }
    const source = getSingleSelectedPng();
    if (source?.file === gridSourceFile) {
      renderGridPreview();
      return;
    }

    gridSourceFile = source?.file ?? null;
    gridImageWidth = null;
    gridImageHeight = null;
    gridImageError = null;
    gridFitMessage = "";
    gridFitIsError = false;
    gridPreviewImage.removeAttribute("src");
    if (source !== null) {
      gridPreviewImage.alt = `Spritesheet grid preview of ${source.file.name}`;
      gridPreviewImage.src = previewUrls.get(source.file);
    }
    renderGridPreview();
  };

  function applySelectedFiles(files: readonly BrowserSourceFile[]): void {
    if (isConverting) {
      return;
    }
    invalidateConversion();
    selectedFiles = [...files];
    fileInput.value = "";
    renderSelectedFiles();
    syncGridSource();
    updateReadiness();
  }

  const handleGridImageLoad = (): void => {
    if (gridSourceFile === null) {
      return;
    }
    gridImageWidth = gridPreviewImage.naturalWidth;
    gridImageHeight = gridPreviewImage.naturalHeight;
    gridImageError = null;
    synchronizeGridInputs("image-change");
    renderGridPreview();
    updateReadiness();
  };

  const handleGridImageError = (): void => {
    if (gridSourceFile === null) {
      return;
    }
    gridImageWidth = null;
    gridImageHeight = null;
    gridImageError =
      "Could not read the selected PNG dimensions for a grid preview.";
    renderGridPreview();
    updateReadiness();
  };

  const fileImportDependencies: FileImportDependencies = {
    format: mode,
    onFilesImported(files): void {
      if (isConverting) {
        throw new Error(
          "Wait for the current conversion to finish before changing source files.",
        );
      }
      applySelectedFiles(files);
    },
  };
  const fileImportControl = bindFileImportControl(
    fileInput,
    sourceError,
    sourceStatus,
    fileImportDependencies,
    dropZone,
  );

  const handleModeChange = (): void => {
    invalidateConversion();
    mode = modeSelect.value as FileImportFormat;
    fileImportDependencies.format = mode;
    gridFields.hidden = mode !== "spritesheet-grid";
    fileInput.multiple =
      mode === "png-sequence" || mode === "spritesheet-json";
    dropInstructions.textContent = getImportDropInstructions(mode);
    renderSelectedFiles();
    syncGridSource();
    updateReadiness();
  };

  const handleFrameSizeInput = (): void => {
    invalidateConversion();
    synchronizeGridInputs("frame-size");
    renderGridPreview();
    updateReadiness();
  };

  const handleGridLayoutInput = (): void => {
    invalidateConversion();
    synchronizeGridInputs("grid-size");
    renderGridPreview();
    updateReadiness();
  };

  const handleFrameOrderChange = (): void => {
    invalidateConversion();
    renderGridPreview();
    updateReadiness();
  };

  const handleClearFiles = (): void => {
    applySelectedFiles([]);
  };

  const handleConvert = async (): Promise<void> => {
    if (isConverting || selectedFiles.length === 0) {
      return;
    }
    const request = ++conversionRequest;
    isConverting = true;
    syncProject(null);
    renderConversionState(conversionElements, {
      isWorking: true,
      canConvert: true,
      status:
        mode === "piskel"
          ? "Converting the Piskel project browser-locally. This may take a while."
          : mode === "gif"
            ? "Converting the GIF animation browser-locally. This may take a while."
            : mode === "apng"
                ? "Converting the APNG animation browser-locally. This may take a while."
                : mode === "openraster"
                  ? "Converting the OpenRaster project browser-locally. This may take a while."
                  : mode === "pixelorama"
                    ? "Converting the Pixelorama project browser-locally. This may take a while."
                    : mode === "krita"
                      ? "Converting the Krita project browser-locally. This may take a while."
                      : mode === "psd"
                        ? "Converting the PSD project browser-locally. This may take a while."
                      : "Converting files browser-locally. This may take a while.",
    });

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (request !== conversionRequest) {
        return;
      }
      const project = await convertSourceFiles(
        mode,
        selectedFiles,
        readGridOptions(),
      );
      if (request !== conversionRequest) {
        return;
      }
      syncProject(project);
      renderConversionState(conversionElements, {
        isWorking: false,
        canConvert: true,
        status: getConversionSuccessStatus(mode, project),
      });
    } catch (error) {
      if (request !== conversionRequest) {
        return;
      }
      syncProject(null);
      renderConversionState(conversionElements, {
        isWorking: false,
        canConvert: true,
        status:
          mode === "piskel"
            ? "Piskel conversion did not complete."
            : mode === "gif"
              ? "GIF conversion did not complete."
              : mode === "apng"
                ? "APNG conversion did not complete."
                : mode === "openraster"
                  ? "OpenRaster conversion did not complete."
                  : mode === "pixelorama"
                    ? "Pixelorama conversion did not complete."
                    : mode === "krita"
                      ? "Krita conversion did not complete."
                      : mode === "psd"
                        ? "PSD conversion did not complete."
                      : "Conversion did not complete.",
        error: getConversionErrorMessage(mode, error),
      });
    } finally {
      if (request === conversionRequest) {
        isConverting = false;
      }
    }
  };

  modeSelect.addEventListener("change", handleModeChange);
  frameWidth.input.addEventListener("input", handleFrameSizeInput);
  frameHeight.input.addEventListener("input", handleFrameSizeInput);
  rows.input.addEventListener("input", handleGridLayoutInput);
  columns.input.addEventListener("input", handleGridLayoutInput);
  frameOrder.addEventListener("change", handleFrameOrderChange);
  gridPreviewImage.addEventListener("load", handleGridImageLoad);
  gridPreviewImage.addEventListener("error", handleGridImageError);
  clearFilesButton.addEventListener("click", handleClearFiles);
  convertButton.addEventListener("click", handleConvert);
  renderSelectedFiles();
  handleModeChange();

  return {
    destroy(): void {
      conversionRequest += 1;
      modeSelect.removeEventListener("change", handleModeChange);
      frameWidth.input.removeEventListener("input", handleFrameSizeInput);
      frameHeight.input.removeEventListener("input", handleFrameSizeInput);
      rows.input.removeEventListener("input", handleGridLayoutInput);
      columns.input.removeEventListener("input", handleGridLayoutInput);
      frameOrder.removeEventListener("change", handleFrameOrderChange);
      gridPreviewImage.removeEventListener("load", handleGridImageLoad);
      gridPreviewImage.removeEventListener("error", handleGridImageError);
      clearFilesButton.removeEventListener("click", handleClearFiles);
      convertButton.removeEventListener("click", handleConvert);
      fileImportControl.destroy();
      previewUrls.clear();
      previewUi.destroy();
      layerUi.destroy();
      exportUi.destroy();
      root.replaceChildren();
    },
  };
}
