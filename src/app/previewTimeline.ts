import type { SpriteProject } from "../core/SpriteProject";

export type PreviewTimelineControl = {
  destroy(): void;
  getActiveFrameIndex(): number | null;
  setProject(project: SpriteProject | null): void;
};

export type PreviewTimelineUi = PreviewTimelineControl & {
  element: HTMLElement;
};

export function mountPreviewTimelineUi(
  container: HTMLElement,
): PreviewTimelineUi {
  const document = container.ownerDocument;
  const element = document.createElement("section");
  const heading = document.createElement("h2");
  const emptyState = document.createElement("p");
  const navigation = document.createElement("div");
  const previousButton = document.createElement("button");
  const nextButton = document.createElement("button");
  const activeFrameOutput = document.createElement("p");
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
  timeline.setAttribute("aria-label", "Imported frames");
  navigation.append(previousButton, nextButton);
  element.append(
    heading,
    emptyState,
    navigation,
    activeFrameOutput,
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

  const renderActiveFrame = (): void => {
    const frames = currentProject?.frames ?? [];
    const hasActiveFrame = activePosition >= 0 && activePosition < frames.length;

    previousButton.disabled = !hasActiveFrame || activePosition === 0;
    nextButton.disabled =
      !hasActiveFrame || activePosition === frames.length - 1;
    activeFrameOutput.hidden = !hasActiveFrame;

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
    } else {
      activeFrameOutput.textContent = "";
    }
  };

  const selectFrame = (position: number): void => {
    const frameCount = currentProject?.frames.length ?? 0;
    if (position < 0 || position >= frameCount) {
      return;
    }
    activePosition = position;
    renderActiveFrame();
  };

  const handlePrevious = (): void => {
    selectFrame(activePosition - 1);
  };

  const handleNext = (): void => {
    selectFrame(activePosition + 1);
  };

  previousButton.addEventListener("click", handlePrevious);
  nextButton.addEventListener("click", handleNext);

  const control: PreviewTimelineControl = {
    destroy(): void {
      clearFrameButtons();
      previousButton.removeEventListener("click", handlePrevious);
      nextButton.removeEventListener("click", handleNext);
    },
    getActiveFrameIndex(): number | null {
      return currentProject?.frames[activePosition]?.index ?? null;
    },
    setProject(project: SpriteProject | null): void {
      currentProject = project;
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
