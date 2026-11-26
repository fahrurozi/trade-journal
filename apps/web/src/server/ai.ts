import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, RetryError, generateText } from "ai";
import {
  aiProviderConfigured,
  getAiKey,
  getAiModel,
  getAiProvider,
  getCompatibleBaseUrl,
} from "./settings";
import { AI_PROVIDER_NAMES, type AiProvider } from "@/lib/ai-settings";

/**
 * BYO-key AI. Self-hosted means YOUR key on YOUR box: the key is read from the
 * encrypted settings store (or the selected provider's environment variable).
 * Requests go straight from this server to the selected provider.
 */
export const aiConfigured = (): boolean => aiProviderConfigured(getAiProvider());

const SYSTEM = `You are the reflection layer of a trader's journal.
You see only the trader's own recorded data — trades, stats, and notes. Ground every
statement in those numbers; never invent trades, prices, or market context you weren't given.
Be direct and specific like a good trading coach: name the behavior, cite the numbers,
say what to keep and what to fix. No platitudes, no disclaimers about trading being risky —
the trader knows. Keep it tight.`;

const languageModel = (provider: AiProvider, apiKey: string | null, model: string) => {
  if (provider === "compatible")
    // Chat Completions is the API compatible servers share. Only the key saved for
    // this server is sent: this adapter never reads provider environment variables.
    return createOpenAICompatible({
      name: "compatible",
      baseURL: getCompatibleBaseUrl()!,
      apiKey: apiKey ?? undefined,
    })(model);
  return provider === "openai"
    ? createOpenAI({ apiKey: apiKey! }).responses(model)
    : createAnthropic({ apiKey: apiKey! })(model);
};

export const runAi = async (
  prompt: string,
  maxOutputTokens = 1200,
  selection?: { provider: AiProvider; model: string },
  options?: { system: string; signal: AbortSignal },
): Promise<string> => {
  const provider = selection?.provider ?? getAiProvider();
  if (!aiProviderConfigured(provider)) {
    throw new Error(
      provider === "compatible"
        ? "AI is not configured — add your OpenAI-compatible server URL and model in Settings."
        : `AI is not configured — add your ${AI_PROVIDER_NAMES[provider]} API key in Settings.`,
    );
  }
  const timeout = options && AbortSignal.timeout(75000);
  try {
    const result = await generateText({
      model: languageModel(provider, getAiKey(provider), selection?.model ?? getAiModel(provider)),
      ...(provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
      system: options?.system ?? SYSTEM,
      prompt,
      maxOutputTokens,
      ...(options && timeout ? { abortSignal: AbortSignal.any([options.signal, timeout]) } : {}),
    });
    if (result.text.trim()) return result.text;
    throw new EmptyAiAnswer(result.finishReason === "length");
  } catch (error) {
    if (timeout?.aborted)
      throw new Error("AI request timed out. Try again or choose a faster model.");
    if (error instanceof EmptyAiAnswer) throw error;
    if (RetryError.isInstance(error)) error = error.lastError;
    // Provider error messages can contain key fragments or request data. Never relay them.
    if (APICallError.isInstance(error)) {
      if (error.statusCode === 401 || error.statusCode === 403)
        throw new Error(
          "AI authentication_error: check your provider key and permissions in Settings.",
        );
      if (
        error.statusCode === 402 ||
        /credit balance|billing|insufficient_quota|exceeded your current quota/i.test(error.message)
      )
        throw new Error("AI billing: check your provider account's credits and quota.");
      if (error.statusCode === 429 || error.statusCode === 529)
        throw new Error("AI rate limit: please try again shortly.");
      if (
        error.statusCode === 404 ||
        /model.*(?:not found|does not exist|access)/i.test(error.message)
      )
        throw new Error(
          "AI model unavailable: check the model ID and your provider access in Settings.",
        );
      // No status code means no HTTP response: the server is down or the URL is wrong.
      if (provider === "compatible" && error.statusCode === undefined)
        throw new Error(
          "AI server unreachable: check the server URL in Settings and that the server is running.",
        );
      if (options && error.statusCode && error.statusCode >= 500)
        throw new Error("AI provider temporarily unavailable. Try again shortly.");
    }
    throw new Error("AI request failed. Check your provider settings or try again shortly.");
  }
};

class EmptyAiAnswer extends Error {
  constructor(lengthLimited: boolean) {
    super(
      lengthLimited
        ? "AI ran out of output tokens before it could answer. Try a shorter question or another model."
        : "AI returned no answer. Try again or choose another model.",
    );
  }
}
