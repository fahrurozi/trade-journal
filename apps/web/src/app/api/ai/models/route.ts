import { isAiProviderId } from "@/lib/ai-settings";
import { bad, handler, ok, requireValue } from "@/server/api";
import { getAiBaseUrl, getAiKey, normalizeAiBaseUrl } from "@/server/settings";

async function models(baseUrl: string, key: string | null, anthropic = false) {
  const headers = new Headers();
  if (anthropic) {
    if (key) headers.set("x-api-key", key);
    headers.set("anthropic-version", "2023-06-01");
  } else if (key) headers.set("Authorization", `Bearer ${key}`);
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return bad(`Could not list models (HTTP ${response.status}).`, 502);
    const { data } = (await response.json()) as { data?: { id?: unknown }[] };
    if (!Array.isArray(data)) return bad("The server did not return a model list.", 502);
    return ok({
      models: [
        ...new Set(
          data.flatMap((row) =>
            typeof row?.id === "string" && row.id.trim() && row.id.length <= 200 ? [row.id] : [],
          ),
        ),
      ].sort(),
    });
  } catch {
    return bad("Could not load models. Check the server URL and API key.", 502);
  }
}

function hostedUrl(provider: "anthropic" | "openai") {
  return (
    provider === "anthropic"
      ? process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com/v1"
      : process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
}

export const GET = handler((request: Request) => {
  const id = new URL(request.url).searchParams.get("provider") ?? "compatible";
  requireValue(isAiProviderId(id), "Choose a provider.");
  const key = getAiKey(id);
  if (id === "anthropic" || id === "openai")
    return key ? models(hostedUrl(id), key, id === "anthropic") : ok({ models: [] });
  const baseUrl = getAiBaseUrl(id);
  return baseUrl ? models(baseUrl, key) : ok({ models: [] });
});

export const POST = handler(async (request: Request) => {
  const {
    provider = "compatible",
    baseUrl,
    apiKey,
  } = ((await request.json()) ?? {}) as {
    provider?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
  };
  requireValue(provider === "new" || isAiProviderId(provider), "Choose a provider.");
  requireValue(
    typeof apiKey === "string" && apiKey.length <= 4096 && !/\s/.test(apiKey.trim()),
    "Invalid API key.",
  );
  if (provider === "openai" || provider === "anthropic") {
    const key = apiKey.trim() || getAiKey(provider);
    requireValue(key, "Enter an API key.");
    return models(hostedUrl(provider), key, provider === "anthropic");
  }
  const normalized = typeof baseUrl === "string" && normalizeAiBaseUrl(baseUrl);
  requireValue(normalized, "Enter a valid server URL.");
  const key =
    apiKey.trim() ||
    (provider !== "new" && normalized === getAiBaseUrl(provider) ? getAiKey(provider) : null);
  return models(normalized, key);
});
