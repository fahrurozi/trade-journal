import { EventSourceParserStream } from "eventsource-parser/stream";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, RetryError, generateText } from "ai";
import {
  aiProviderConfigured,
  getAiKey,
  getAiModel,
  getAiProvider,
  getAiBaseUrl,
} from "./settings";
import { AI_PROVIDER_NAMES, type AiProviderId } from "@/lib/ai-settings";

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

const languageModel = (provider: "anthropic" | "openai", apiKey: string, model: string) =>
  provider === "openai"
    ? createOpenAI({ apiKey }).responses(model)
    : createAnthropic({ apiKey })(model);

class CompatibleRequestError extends Error {
  constructor(
    public status?: number,
    message?: string,
  ) {
    super(message);
  }
}

interface CompatibleCompletion {
  choices?: Array<{
    message?: { content?: unknown };
    delta?: { content?: unknown };
    finish_reason?: string;
  }>;
  error?: { message?: unknown; code?: unknown } | string;
}

const compatibleText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
          .join("")
      : "";

function compatibleError(status: number, error: CompatibleCompletion["error"]) {
  const message = typeof error === "string" ? error : error?.message;
  const code = typeof error === "object" ? Number(error?.code) : NaN;
  return new CompatibleRequestError(
    status >= 400 ? status : code >= 400 && code < 600 ? code : 400,
    typeof message === "string" ? message : undefined,
  );
}

async function compatibleStream(body: ReadableStream<Uint8Array<ArrayBuffer>>) {
  const reader = body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader();
  let answer = "";
  let lengthLimited = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || value.data === "[DONE]") break;
      const event = JSON.parse(value.data) as CompatibleCompletion;
      if (event.error) throw compatibleError(200, event.error);
      const choice = event.choices?.[0];
      answer += compatibleText(choice?.delta?.content ?? choice?.message?.content);
      if (choice?.finish_reason === "length") lengthLimited = true;
    }
  } catch (error) {
    if (error instanceof CompatibleRequestError) throw error;
    throw new UnsupportedAiResponse();
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (answer.trim()) return answer;
  throw new EmptyAiAnswer(lengthLimited);
}

/** Gateways can omit usage and other metadata from Chat Completions responses. */
async function compatibleChat(
  baseUrl: string,
  apiKey: string | null,
  model: string,
  system: string,
  prompt: string,
  maxOutputTokens: number,
  signal: AbortSignal,
  stream: boolean,
) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: maxOutputTokens,
        stream,
      }),
    });
  } catch {
    throw new CompatibleRequestError();
  }
  if (
    response.ok &&
    response.body &&
    response.headers.get("content-type")?.includes("text/event-stream")
  )
    return compatibleStream(response.body);
  const body = (await response.json().catch(() => null)) as CompatibleCompletion | null;
  if (!response.ok || body?.error) throw compatibleError(response.status, body?.error);
  const choice = Array.isArray(body?.choices) ? body.choices[0] : undefined;
  if (!choice) throw new UnsupportedAiResponse();
  const answer = compatibleText(choice.message?.content);
  if (answer.trim()) return answer;
  throw new EmptyAiAnswer(choice.finish_reason === "length");
}

export const runAi = async (
  prompt: string,
  maxOutputTokens = 1200,
  selection?: { provider: AiProviderId; model: string },
  options?: { system: string; signal: AbortSignal },
): Promise<string> => {
  const provider = selection?.provider ?? getAiProvider();
  const model = selection?.model ?? getAiModel(provider);
  const apiKey = getAiKey(provider);
  const hosted = provider === "openai" || provider === "anthropic";
  const baseUrl = hosted ? null : getAiBaseUrl(provider);
  if (hosted ? !apiKey : !baseUrl || !model) {
    throw new Error(
      hosted
        ? `AI is not configured — add your ${AI_PROVIDER_NAMES[provider]} API key in Settings.`
        : "AI is not configured — add an OpenAI-compatible server URL and model. Set the URL in Settings and choose the model on the AI page.",
    );
  }
  const timeout = AbortSignal.timeout(75000);
  const signal = options ? AbortSignal.any([options.signal, timeout]) : timeout;
  const system = options?.system ?? SYSTEM;
  try {
    if (baseUrl)
      return await compatibleChat(
        baseUrl,
        apiKey,
        model,
        system,
        prompt,
        maxOutputTokens,
        signal,
        Boolean(options),
      );
    if (!hosted || !apiKey) throw new Error("AI is not configured.");
    const result = await generateText({
      model: languageModel(provider, apiKey, model),
      ...(provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
      system,
      prompt,
      maxOutputTokens,
      abortSignal: signal,
    });
    if (result.text.trim()) return result.text;
    throw new EmptyAiAnswer(result.finishReason === "length");
  } catch (error) {
    if (timeout.aborted)
      throw new Error("AI request timed out. Try again or choose a faster model.");
    if (error instanceof EmptyAiAnswer || error instanceof UnsupportedAiResponse) throw error;
    if (RetryError.isInstance(error)) error = error.lastError;
    // Provider error messages can contain key fragments or request data. Never relay them.
    if (APICallError.isInstance(error) || error instanceof CompatibleRequestError) {
      const status = error instanceof CompatibleRequestError ? error.status : error.statusCode;
      if (status === 401 || status === 403)
        throw new Error(
          "AI authentication_error: check your provider key and permissions in Settings.",
        );
      if (
        status === 402 ||
        /credit balance|billing|insufficient_quota|exceeded your current quota/i.test(error.message)
      )
        throw new Error("AI billing: check your provider account's credits and quota.");
      if (status === 429 || status === 529)
        throw new Error("AI rate limit: please try again shortly.");
      if (status === 404 || /model.*(?:not found|does not exist|access)/i.test(error.message))
        throw new Error(
          "AI model unavailable: check the model ID and your provider access, then choose a model on the AI page.",
        );
      if (status === 400 || status === 406 || status === 422)
        throw new Error("AI model rejected this request. Try another model.");
      // No status code means no HTTP response: the server is down or the URL is wrong.
      if (!hosted && status === undefined)
        throw new Error(
          "AI server unreachable: check the server URL in Settings and that the server is running.",
        );
      if (status && status >= 500)
        throw new Error("AI provider temporarily unavailable. Try again shortly.");
    }
    throw new Error("AI request failed. Check your provider settings or try again shortly.");
  }
};

class UnsupportedAiResponse extends Error {
  constructor() {
    super("AI server returned an unsupported response. Try another model.");
  }
}

class EmptyAiAnswer extends Error {
  constructor(lengthLimited: boolean) {
    super(
      lengthLimited
        ? "AI ran out of output tokens before it could answer. Try a shorter question or another model."
        : "AI returned no answer. Try again or choose another model.",
    );
  }
}
