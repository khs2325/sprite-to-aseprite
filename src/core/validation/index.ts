import type { SpriteProject } from "../SpriteProject";

export type SpriteProjectValidationError = {
  code: string;
  path: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function addError(
  errors: SpriteProjectValidationError[],
  code: string,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

export function validateSpriteProject(
  project: unknown,
): SpriteProjectValidationError[] {
  const errors: SpriteProjectValidationError[] = [];

  if (!isRecord(project)) {
    addError(errors, "invalid_project", "project", "Project must be an object.");
    return errors;
  }

  const widthIsValid = isPositiveInteger(project.width);
  const heightIsValid = isPositiveInteger(project.height);

  if (!widthIsValid) {
    addError(
      errors,
      "invalid_width",
      "width",
      "Project width must be a positive integer.",
    );
  }
  if (!heightIsValid) {
    addError(
      errors,
      "invalid_height",
      "height",
      "Project height must be a positive integer.",
    );
  }
  if (project.colorMode !== "rgba") {
    addError(
      errors,
      "invalid_color_mode",
      "colorMode",
      'Project color mode must be "rgba".',
    );
  }

  const frameIndexes = new Set<number>();
  if (!Array.isArray(project.frames) || project.frames.length === 0) {
    addError(
      errors,
      "invalid_frames",
      "frames",
      "Project must contain at least one frame.",
    );
  } else {
    project.frames.forEach((frame, position) => {
      const path = `frames[${position}]`;
      if (!isRecord(frame)) {
        addError(errors, "invalid_frame", path, "Frame must be an object.");
        return;
      }

      if (!Number.isInteger(frame.index) || (frame.index as number) < 0) {
        addError(
          errors,
          "invalid_frame_index",
          `${path}.index`,
          "Frame index must be a non-negative integer.",
        );
      } else {
        const frameIndex = frame.index as number;
        if (frameIndex !== position) {
          addError(
            errors,
            "invalid_frame_index",
            `${path}.index`,
            `Frame index must be ${position} to keep frames zero-based and ordered.`,
          );
        } else {
          frameIndexes.add(frameIndex);
        }
      }

      if (!isPositiveInteger(frame.durationMs)) {
        addError(
          errors,
          "invalid_frame_duration",
          `${path}.durationMs`,
          "Frame duration must be a positive integer in milliseconds.",
        );
      }
    });
  }

  const layerIds = new Set<string>();
  if (!Array.isArray(project.layers) || project.layers.length === 0) {
    addError(
      errors,
      "invalid_layers",
      "layers",
      "Project must contain at least one layer.",
    );
    return errors;
  }

  project.layers.forEach((layer, layerIndex) => {
    const layerPath = `layers[${layerIndex}]`;
    if (!isRecord(layer)) {
      addError(errors, "invalid_layer", layerPath, "Layer must be an object.");
      return;
    }

    if (typeof layer.id !== "string" || layer.id.trim().length === 0) {
      addError(
        errors,
        "invalid_layer_id",
        `${layerPath}.id`,
        "Layer id must be a non-empty string.",
      );
    } else if (layerIds.has(layer.id)) {
      addError(
        errors,
        "duplicate_layer_id",
        `${layerPath}.id`,
        `Layer id "${layer.id}" is duplicated.`,
      );
    } else {
      layerIds.add(layer.id);
    }

    if (typeof layer.name !== "string") {
      addError(
        errors,
        "invalid_layer_name",
        `${layerPath}.name`,
        "Layer name must be a string.",
      );
    }
    if (typeof layer.visible !== "boolean") {
      addError(
        errors,
        "invalid_layer_visibility",
        `${layerPath}.visible`,
        "Layer visibility must be a boolean.",
      );
    }
    if (
      !Number.isInteger(layer.opacity) ||
      (layer.opacity as number) < 0 ||
      (layer.opacity as number) > 255
    ) {
      addError(
        errors,
        "invalid_layer_opacity",
        `${layerPath}.opacity`,
        "Layer opacity must be an integer from 0 to 255.",
      );
    }

    if (!Array.isArray(layer.cels)) {
      addError(
        errors,
        "invalid_cels",
        `${layerPath}.cels`,
        "Layer cels must be an array.",
      );
      return;
    }

    const celFrameIndexes = new Set<number>();
    layer.cels.forEach((cel, celIndex) => {
      const celPath = `${layerPath}.cels[${celIndex}]`;
      if (!isRecord(cel)) {
        addError(errors, "invalid_cel", celPath, "Cel must be an object.");
        return;
      }

      if (
        !Number.isInteger(cel.frameIndex) ||
        !frameIndexes.has(cel.frameIndex as number)
      ) {
        addError(
          errors,
          "invalid_cel_frame_reference",
          `${celPath}.frameIndex`,
          "Cel frame index must reference an existing project frame.",
        );
      } else if (celFrameIndexes.has(cel.frameIndex as number)) {
        addError(
          errors,
          "duplicate_cel_frame",
          `${celPath}.frameIndex`,
          "A layer cannot contain more than one cel for the same frame.",
        );
      } else {
        celFrameIndexes.add(cel.frameIndex as number);
      }

      const imageData = cel.imageData;
      const imageWidth =
        isRecord(imageData) && isPositiveInteger(imageData.width)
          ? imageData.width
          : undefined;
      const imageHeight =
        isRecord(imageData) && isPositiveInteger(imageData.height)
          ? imageData.height
          : undefined;
      const imageDataIsValid =
        isRecord(imageData) &&
        imageWidth !== undefined &&
        imageHeight !== undefined &&
        (imageData.colorSpace === "srgb" ||
          imageData.colorSpace === "display-p3") &&
        imageData.data instanceof Uint8ClampedArray &&
        imageData.data.length === imageWidth * imageHeight * 4;

      if (!imageDataIsValid) {
        addError(
          errors,
          "invalid_cel_image_data",
          `${celPath}.imageData`,
          "Cel image data must contain width × height × 4 RGBA bytes.",
        );
      }

      if (!Number.isInteger(cel.x) || (cel.x as number) < 0) {
        addError(
          errors,
          "invalid_cel_x",
          `${celPath}.x`,
          "Cel x position must be a non-negative integer.",
        );
      }
      if (!Number.isInteger(cel.y) || (cel.y as number) < 0) {
        addError(
          errors,
          "invalid_cel_y",
          `${celPath}.y`,
          "Cel y position must be a non-negative integer.",
        );
      }

      if (
        widthIsValid &&
        imageDataIsValid &&
        Number.isInteger(cel.x) &&
        (cel.x as number) >= 0 &&
        (cel.x as number) + imageWidth! > (project.width as number)
      ) {
        addError(
          errors,
          "cel_out_of_bounds",
          `${celPath}.x`,
          "Cel image extends beyond the project width.",
        );
      }
      if (
        heightIsValid &&
        imageDataIsValid &&
        Number.isInteger(cel.y) &&
        (cel.y as number) >= 0 &&
        (cel.y as number) + imageHeight! > (project.height as number)
      ) {
        addError(
          errors,
          "cel_out_of_bounds",
          `${celPath}.y`,
          "Cel image extends beyond the project height.",
        );
      }
    });
  });

  return errors;
}

export function isValidSpriteProject(project: unknown): project is SpriteProject {
  return validateSpriteProject(project).length === 0;
}
