// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PromptComposer from "../src/components/ui/prompt-composer";

let container: HTMLDivElement;
let root: Root;
let motion: EventTarget & { matches: boolean };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal("matchMedia", () => motion);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const renderComposer = () =>
  act(async () =>
    root.render(
      createElement(PromptComposer, {
        prompts: ["Win", "Loss"],
        placeholder: "Ask about your trades",
        controls: null,
        maxLength: 10000,
        disabled: false,
        onSubmit: vi.fn(),
        onAttach: vi.fn(),
      }),
    ),
  );
const placeholderText = () => container.querySelector("textarea + span")?.textContent;
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

it("types, erases and advances to the next prompt, then pauses while focused", async () => {
  await renderComposer();
  expect(placeholderText()).toBe("Ask about your trades");
  advance(600);
  expect(placeholderText()).toBe("W");
  advance(90);
  expect(placeholderText()).toBe("Win");
  advance(2200);
  expect(placeholderText()).toBe("Wi");
  advance(382);
  expect(placeholderText()).toBe("L");

  act(() => container.querySelector("textarea")!.focus());
  advance(3000);
  expect(placeholderText()).toBe("Ask about your trades");
  act(() => container.querySelector("textarea")!.blur());
  advance(600);
  expect(placeholderText()).toBe("W");
});

it("shows a static example and cancels typing when reduced motion is enabled", async () => {
  await renderComposer();
  advance(600);
  expect(placeholderText()).toBe("W");

  act(() => {
    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
  });
  advance(3000);
  expect(placeholderText()).toBe("Win");
});
