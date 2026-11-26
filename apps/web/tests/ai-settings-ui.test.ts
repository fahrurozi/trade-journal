// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiConnection, AiProvider, AiSettingsPayload } from "../src/lib/ai-settings";
const state = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  data: undefined as unknown,
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: () => ({ data: state.data, error: null, loading: false, refresh: state.refresh }),
}));
vi.mock("@/components/ui/option-select", () => ({
  OptionSelect: ({
    onValueChange,
    ...props
  }: React.ComponentProps<"select"> & { onValueChange: (value: string) => void }) =>
    createElement("select", {
      ...props,
      onChange: (event) => onValueChange(event.currentTarget.value),
    }),
}));
const { AiSettings } = await import("../src/components/ai-settings");
let container: HTMLDivElement;
let root: Root;
const connection = (model: string, extra: Partial<AiConnection> = {}): AiConnection => ({
  configured: false,
  source: null,
  model,
  baseUrl: null,
  ...extra,
});
const settings = (
  aiProvider: AiProvider,
  connections: Partial<Record<AiProvider, AiConnection>> = {},
): AiSettingsPayload => {
  const aiConnections = {
    anthropic: connection("claude-opus-5"),
    openai: connection("gpt-4.1-mini"),
    compatible: connection(""),
    ...connections,
  };
  return {
    aiProvider,
    aiConfigured: aiConnections[aiProvider].configured,
    aiModel: aiConnections[aiProvider].model,
    aiConnections,
  };
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.post.mockReset().mockResolvedValue({ saved: true });
  state.refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const render = (data: AiSettingsPayload) => {
  state.data = data;
  return act(async () => root.render(createElement(AiSettings)));
};
const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`);
const type = (id: string, value: string) =>
  act(async () => {
    const input = field(id)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const button = (text: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (element) => element.textContent === text,
  )!;
const choose = (id: string) =>
  act(async () => {
    const select = container.querySelector<HTMLSelectElement>("#ai-provider")!;
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

it("tests and saves a custom provider without choosing a model", async () => {
  await render(settings("anthropic"));
  await choose("new");
  expect(field("ai-model")).toBeNull();
  expect(button("Save provider").disabled).toBe(true);
  await type("ai-base-url", "http://localhost:11434/v1");
  await act(async () => button("Test connection").click());
  expect(state.post).toHaveBeenCalledWith("/api/ai/models", {
    provider: "new",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
  });
  expect(container.textContent).toContain("Connection successful.");
  await type("ai-name", "Local Ollama");
  await act(async () => button("Save provider").click());
  expect(state.post).toHaveBeenCalledWith("/api/ai/connections", {
    id: undefined,
    name: "Local Ollama",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "",
  });
  expect(state.refresh).toHaveBeenCalled();
});

it("lists independent custom providers and preserves legacy connections", async () => {
  const first = "custom:11111111-1111-1111-1111-111111111111";
  const second = "custom:22222222-2222-2222-2222-222222222222";
  await render({
    ...settings("compatible", {
      compatible: connection("router-model", {
        configured: true,
        source: "saved",
        baseUrl: "https://router.example/api/v1",
      }),
    }),
    customAiProviders: [
      { ...connection(""), id: first, name: "Local", baseUrl: "https://local.example/v1" },
      { ...connection(""), id: second, name: "Remote", baseUrl: "https://remote.example/v1" },
    ],
  });
  await choose(first);
  expect(field("ai-base-url")!.value).toBe("https://local.example/v1");
  await choose(second);
  expect(field("ai-base-url")!.value).toBe("https://remote.example/v1");
  await choose("compatible");
  expect(field("ai-base-url")!.value).toBe("https://router.example/api/v1");
  expect(button("Remove provider")).toBeTruthy();
});

it("saves a hosted API key without changing model selection", async () => {
  await render(settings("openai"));
  await choose("openai");
  expect(field("ai-base-url")).toBeNull();
  await type("ai-api-key", "fixture-key");
  await act(async () => button("Save provider").click());
  expect(state.post).toHaveBeenCalledWith("/api/settings", { openaiKey: "fixture-key" }, "PATCH");
});
