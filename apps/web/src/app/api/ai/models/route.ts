import { bad, handler, ok, requireValue } from "@/server/api";
import { getAiKey, getCompatibleBaseUrl, normalizeAiBaseUrl } from "@/server/settings";

async function models(baseUrl: string, key: string | null) {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return bad(`Could not list models (HTTP ${response.status}).`, 502);
    const { data } = (await response.json()) as { data?: { id?: unknown }[] };
    if (!Array.isArray(data)) return bad("The server did not return an OpenAI model list.", 502);
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

export const GET = handler(() => {
  const baseUrl = getCompatibleBaseUrl();
  return baseUrl ? models(baseUrl, getAiKey("compatible")) : ok({ models: [] });
});

export const POST = handler(async (request: Request) => {
  const { baseUrl, apiKey } = (await request.json()) as { baseUrl?: unknown; apiKey?: unknown };
  const normalized = typeof baseUrl === "string" && normalizeAiBaseUrl(baseUrl);
  requireValue(normalized, "Enter a valid server URL.");
  requireValue(typeof apiKey === "string" && apiKey.length <= 4096, "Invalid API key.");
  const key =
    apiKey.trim() || (normalized === getCompatibleBaseUrl() ? getAiKey("compatible") : null);
  return models(normalized, key);
});
