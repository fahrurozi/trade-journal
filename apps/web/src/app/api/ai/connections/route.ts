import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { isCustomAiProviderId, type CustomAiProvider } from "@/lib/ai-settings";
import { handler, ok, requireValue } from "@/server/api";
import {
  aiModelSetting,
  deleteSetting,
  getAiBaseUrl,
  getCustomAiProviders,
  getSetting,
  normalizeAiBaseUrl,
  setAiKey,
  setCompatibleBaseUrl,
  setSetting,
} from "@/server/settings";

export const POST = handler(async (request: Request) => {
  const { id, name, baseUrl, apiKey } = ((await request.json()) ?? {}) as {
    id?: unknown;
    name?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
  };
  const url = typeof baseUrl === "string" && normalizeAiBaseUrl(baseUrl);
  requireValue(url, "Enter a valid server URL.");
  requireValue(
    typeof apiKey === "string" && apiKey.length <= 4096 && !/\s/.test(apiKey.trim()),
    "Enter a valid API key.",
  );
  db.transaction(() => {
    if (id === "compatible") {
      if (url !== getAiBaseUrl(id)) deleteSetting(aiModelSetting(id));
      setCompatibleBaseUrl(url, Boolean(apiKey.trim()));
      if (apiKey.trim()) setAiKey(id, apiKey);
      return;
    }
    requireValue(
      typeof name === "string" && name.trim() && name.length <= 80,
      "Enter a provider name (up to 80 characters).",
    );
    const providers = getCustomAiProviders();
    requireValue(
      id === undefined || (isCustomAiProviderId(id) && providers.some((p) => p.id === id)),
      "This provider no longer exists.",
    );
    const profile: CustomAiProvider = {
      id: id ?? `custom:${randomUUID()}`,
      name: name.trim(),
      baseUrl: url,
    };
    const previousUrl = getAiBaseUrl(profile.id);
    if (apiKey.trim()) setAiKey(profile.id, apiKey);
    else if (url !== previousUrl) setAiKey(profile.id, null);
    if (previousUrl && url !== previousUrl) deleteSetting(aiModelSetting(profile.id));
    setSetting(
      "customAiProviders",
      JSON.stringify(
        id ? providers.map((p) => (p.id === id ? profile : p)) : [...providers, profile],
      ),
    );
  });
  return ok({ saved: true });
});

export const DELETE = handler(async (request: Request) => {
  const { id } = ((await request.json()) ?? {}) as { id?: unknown };
  requireValue(id === "compatible" || isCustomAiProviderId(id), "Choose a custom provider.");
  db.transaction(() => {
    if (id === "compatible") deleteSetting("compatibleBaseUrl");
    else {
      setSetting(
        "customAiProviders",
        JSON.stringify(getCustomAiProviders().filter((p) => p.id !== id)),
      );
    }
    setAiKey(id, null);
    deleteSetting(aiModelSetting(id));
    if (getSetting("aiProvider") === id) deleteSetting("aiProvider");
  });
  return ok({ saved: true });
});
