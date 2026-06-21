import { describe, expect, it, vi } from "vitest";

import type { SpriteProject } from "../core/SpriteProject";
import { mountPreviewTimelineUi } from "./previewTimeline";

type Listener = () => void;

class ElementStub {
  readonly attributes = new Map<string, string>();
  readonly children: ElementStub[] = [];
  readonly listeners = new Map<string, Listener>();
  disabled = false;
  hidden = false;
  textContent = "";
  type = "";
  max = "";
  min = "";
  step = "";
  value = "";

  constructor(
    readonly tagName: string,
    readonly ownerDocument: DocumentStub,
  ) {}

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener as Listener);
  }

  append(...children: ElementStub[]): void {
    this.children.push(...children);
  }

  click(): void {
    this.listeners.get("click")?.();
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  replaceChildren(...children: ElementStub[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class DocumentStub {
  createElement(tagName: string): ElementStub {
    return new ElementStub(tagName, this);
  }
}

function mountTimeline(
  onProjectChange?: (project: SpriteProject) => void,
) {
  const document = new DocumentStub();
  const container = document.createElement("main");
  const control = mountPreviewTimelineUi(
    container as unknown as HTMLElement,
    { onProjectChange },
  );
  const section = container.children[0];
  const emptyState = section.children[1];
  const navigation = section.children[2];
  const activeFrameOutput = section.children[3];
  const durationEditor = section.children[4];
  const timeline = section.children[5];

  return {
    activeFrameOutput,
    control,
    durationEditor,
    durationError: durationEditor.children[2],
    durationInput: durationEditor.children[0].children[0],
    emptyState,
    nextButton: navigation.children[1],
    previousButton: navigation.children[0],
    timeline,
    updateDurationButton: durationEditor.children[1],
  };
}

function createProject(): SpriteProject {
  return {
    width: 1,
    height: 1,
    colorMode: "rgba",
    frames: [
      { index: 0, durationMs: 80 },
      { index: 1, durationMs: 120 },
      { index: 2, durationMs: 160 },
    ],
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

function getFrameButtons(timeline: ElementStub): ElementStub[] {
  return timeline.children.map((item) => item.children[0]);
}

describe("mountPreviewTimelineUi", () => {
  it("shows an empty state before a project is imported", () => {
    const ui = mountTimeline();

    expect(ui.emptyState.hidden).toBe(false);
    expect(ui.emptyState.textContent).toBe(
      "Import sprite files to preview the timeline.",
    );
    expect(ui.timeline.hidden).toBe(true);
    expect(ui.timeline.children).toHaveLength(0);
    expect(ui.activeFrameOutput.hidden).toBe(true);
    expect(ui.durationEditor.hidden).toBe(true);
    expect(ui.previousButton.disabled).toBe(true);
    expect(ui.nextButton.disabled).toBe(true);
    expect(ui.control.getActiveFrameIndex()).toBeNull();
    expect(ui.control.getProject()).toBeNull();
  });

  it("renders frame order and navigates active state without mutating the project", () => {
    const ui = mountTimeline();
    const project = createProject();
    const originalFrames = project.frames.map((frame) => ({ ...frame }));
    Object.freeze(project.frames);
    Object.freeze(project);

    ui.control.setProject(project);

    const frameButtons = getFrameButtons(ui.timeline);
    expect(frameButtons.map((button) => button.textContent)).toEqual([
      "Frame 1 - 80 ms",
      "Frame 2 - 120 ms",
      "Frame 3 - 160 ms",
    ]);
    expect(frameButtons.map((button) => button.getAttribute("aria-current")))
      .toEqual(["true", null, null]);
    expect(ui.control.getActiveFrameIndex()).toBe(0);
    expect(ui.previousButton.disabled).toBe(true);
    expect(ui.nextButton.disabled).toBe(false);

    ui.nextButton.click();
    expect(ui.control.getActiveFrameIndex()).toBe(1);
    expect(ui.activeFrameOutput.textContent).toBe(
      "Frame 2 of 3, 120 milliseconds.",
    );
    expect(frameButtons.map((button) => button.getAttribute("aria-current")))
      .toEqual([null, "true", null]);

    frameButtons[2].click();
    expect(ui.control.getActiveFrameIndex()).toBe(2);
    expect(ui.previousButton.disabled).toBe(false);
    expect(ui.nextButton.disabled).toBe(true);

    ui.previousButton.click();
    expect(ui.control.getActiveFrameIndex()).toBe(1);
    expect(project.frames).toEqual(originalFrames);
  });

  it("edits only the selected frame duration and reports the updated project", () => {
    const onProjectChange = vi.fn<(project: SpriteProject) => void>();
    const ui = mountTimeline(onProjectChange);
    const project = createProject();

    ui.control.setProject(project);
    getFrameButtons(ui.timeline)[1].click();
    ui.durationInput.value = "240";
    ui.updateDurationButton.click();

    const updated = ui.control.getProject();
    expect(updated?.frames).toEqual([
      { index: 0, durationMs: 80 },
      { index: 1, durationMs: 240 },
      { index: 2, durationMs: 160 },
    ]);
    expect(project.frames[1].durationMs).toBe(120);
    expect(updated?.frames.map((frame) => frame.index)).toEqual([0, 1, 2]);
    expect(getFrameButtons(ui.timeline).map((button) => button.textContent))
      .toEqual([
        "Frame 1 - 80 ms",
        "Frame 2 - 240 ms",
        "Frame 3 - 160 ms",
      ]);
    expect(ui.activeFrameOutput.textContent).toBe(
      "Frame 2 of 3, 240 milliseconds.",
    );
    expect(ui.durationError.hidden).toBe(true);
    expect(onProjectChange).toHaveBeenCalledOnce();
    expect(onProjectChange).toHaveBeenCalledWith(updated);
  });

  it.each(["", "0", "-1", "1.5", "Infinity", "65536", "not-a-number"])(
    "rejects invalid duration input %j without changing the project",
    (value) => {
      const onProjectChange = vi.fn();
      const ui = mountTimeline(onProjectChange);
      const project = createProject();
      ui.control.setProject(project);
      const projectBeforeEdit = ui.control.getProject();

      ui.durationInput.value = value;
      ui.updateDurationButton.click();

      expect(ui.control.getProject()).toBe(projectBeforeEdit);
      expect(ui.durationError).toMatchObject({
        hidden: false,
        textContent:
          "Frame duration must be a whole number from 1 to 65535 milliseconds.",
      });
      expect(onProjectChange).not.toHaveBeenCalled();
    },
  );
});
