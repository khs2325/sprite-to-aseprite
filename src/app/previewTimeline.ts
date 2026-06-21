import {
  MAX_FRAME_DURATION_MS,
  MIN_FRAME_DURATION_MS,
  updateFrameDuration,
  type SpriteProject,
} from "../core/SpriteProject";

export type PreviewTimelineDependencies = {
  onProjectChange?(project: SpriteProject): void;
};

export type PreviewTimelineControl = {
  destroy(): void;
  getActiveFrameIndex(): number | null;
  getProject(): SpriteProject | null;
  setProject(project: SpriteProject | null): void;
};

export type PreviewTimelineUi = PreviewTimelineControl & {
  element: HTMLElement;
};

export function mountPreviewTimelineUi(
  container: HTMLElement,
  dependencies: PreviewTimelineDependencies = {},
): PreviewTimelineUi {
  const document = container.ownerDocument;
  const element = document.createElement("section");
  const heading = document.createElement("h2");
  const emptyState = document.createElement("p");
  const navigation = document.createElement("div");
  const previousButton = document.createElement("button");
  const nextButton = document.createElement("button");
  const activeFrameOutput = document.createElement("p");
  const durationEditor = document.createElement("div");
  const durationLabel = document.createElement("label");
  const durationInput = document.createElement("input");
  const updateDurationButton = document.createElement("button");
  const durationError = document.createElement("p");
  const timeline = document.createElement("ol");

  element.setAttribute("aria-label", "Sprite preview timeline");
  heading.textContent = "Preview timeline";
  emptyState.textContent = "Import sprite files to preview the timeline.";
  emptyState.setAttribute("role", "status");
  previousButton.type = "button";
  previousButton.textContent = "Previous frame";
  nextButton.type = "button";
  nextButton.textContent = "Next frame";
  activeFrameOutput.setAttribute("aria-live", "polite");
  durationLabel.textContent = "Frame duration (milliseconds)";
  durationInput.type = "number";
  durationInput.min = String(MIN_FRAME_DURATION_MS);
  durationInput.max = String(MAX_FRAME_DURATION_MS);
  durationInput.step = "1";
  durationInput.setAttribute(
    "aria-label",
    `Frame duration from ${MIN_FRAME_DURATION_MS} to ${MAX_FRAME_DURATION_MS} milliseconds`,
  );
  updateDurationButton.type = "button";
  updateDurationButton.textContent = "Update duration";
  durationError.setAttribute("role", "alert");
  durationLabel.append(durationInput);
  durationEditor.append(durationLabel, updateDurationButton, durationError);
  timeline.setAttribute("aria-label", "Imported frames");
  navigation.append(previousButton, nextButton);
  element.append(
    heading,
    emptyState,
    navigation,
    activeFrameOutput,
    durationEditor,
    timeline,
  );
  container.append(element);

  let currentProject: SpriteProject | null = null;
  let activePosition = -1;
  let frameButtons: HTMLButtonElement[] = [];
  let frameButtonHandlers: Array<() => void> = [];

  const clearFrameButtons = (): void => {
    frameButtons.forEach((button, position) => {
      button.removeEventListener("click", frameButtonHandlers[position]);
    });
    frameButtons = [];
    frameButtonHandlers = [];
    timeline.replaceChildren();
  };

  const clearDurationError = (): void => {
    durationError.hidden = true;
    durationError.textContent = "";
  };

  const renderActiveFrame = (): void => {
    const frames = currentProject?.frames ?? [];
    const hasActiveFrame = activePosition >= 0 && activePosition < frames.length;

    previousButton.disabled = !hasActiveFrame || activePosition === 0;
    nextButton.disabled =
      !hasActiveFrame || activePosition === frames.length - 1;
    activeFrameOutput.hidden = !hasActiveFrame;
    durationEditor.hidden = !hasActiveFrame;

    frameButtons.forEach((button, position) => {
      if (position === activePosition) {
        button.setAttribute("aria-current", "true");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    if (hasActiveFrame) {
      const frame = frames[activePosition];
      activeFrameOutput.textContent =
        `Frame ${activePosition + 1} of ${frames.length}, ` +
        `${frame.durationMs} milliseconds.`;
      durationInput.value = String(frame.durationMs);
    } else {
      activeFrameOutput.textContent = "";
      durationInput.value = "";
    }
  };

  const selectFrame = (position: number): void => {
    const frameCount = currentProject?.frames.length ?? 0;
    if (position < 0 || position >= frameCount) {
      return;
    }
    activePosition = position;
    clearDurationError();
    renderActiveFrame();
  };

  const handlePrevious = (): void => {
    selectFrame(activePosition - 1);
  };

  const handleNext = (): void => {
    selectFrame(activePosition + 1);
  };

  const handleDurationInput = (): void => {
    clearDurationError();
  };

  const handleUpdateDuration = (): void => {
    const frame = currentProject?.frames[activePosition];
    if (currentProject === null || frame === undefined) {
      return;
    }

    const durationMs = Number(durationInput.value);
    try {
      currentProject = updateFrameDuration(
        currentProject,
        frame.index,
        durationMs,
      );
    } catch (error) {
      durationError.textContent =
        error instanceof RangeError
          ? error.message
          : "Could not update the frame duration.";
      durationError.hidden = false;
      return;
    }

    clearDurationError();
    frameButtons[activePosition].textContent =
      `Frame ${activePosition + 1} - ${durationMs} ms`;
    renderActiveFrame();
    dependencies.onProjectChange?.(currentProject);
  };

  previousButton.addEventListener("click", handlePrevious);
  nextButton.addEventListener("click", handleNext);
  durationInput.addEventListener("input", handleDurationInput);
  updateDurationButton.addEventListener("click", handleUpdateDuration);

  const control: PreviewTimelineControl = {
    destroy(): void {
      clearFrameButtons();
      previousButton.removeEventListener("click", handlePrevious);
      nextButton.removeEventListener("click", handleNext);
      durationInput.removeEventListener("input", handleDurationInput);
      updateDurationButton.removeEventListener("click", handleUpdateDuration);
    },
    getActiveFrameIndex(): number | null {
      return currentProject?.frames[activePosition]?.index ?? null;
    },
    getProject(): SpriteProject | null {
      return currentProject;
    },
    setProject(project: SpriteProject | null): void {
      currentProject = project;
      clearDurationError();
      clearFrameButtons();

      const frames = project?.frames ?? [];
      activePosition = frames.length > 0 ? 0 : -1;
      const isEmpty = frames.length === 0;
      emptyState.hidden = !isEmpty;
      timeline.hidden = isEmpty;

      frames.forEach((frame, position) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        const handleSelect = (): void => {
          selectFrame(position);
        };

        button.type = "button";
        button.textContent = `Frame ${position + 1} - ${frame.durationMs} ms`;
        button.addEventListener("click", handleSelect);
        frameButtons.push(button);
        frameButtonHandlers.push(handleSelect);
        item.append(button);
        timeline.append(item);
      });

      renderActiveFrame();
    },
  };

  control.setProject(null);
  return { ...control, element };
}
