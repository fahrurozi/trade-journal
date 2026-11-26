export const AI_PROVIDERS = ["anthropic", "openai", "compatible"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type CustomAiProviderId = `custom:${string}`;
export type AiProviderId = AiProvider | CustomAiProviderId;
export type CustomAiProvider = { id: CustomAiProviderId; name: string; baseUrl: string };

/** OpenAI-compatible servers host different models, so that provider has no default. */
export const AI_DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4.1-mini",
  compatible: "",
};

export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  compatible: "OpenAI-compatible",
};

/** Hosted providers only: a compatible server never receives an environment key. */
export const AI_KEY_VARIABLES: Partial<Record<AiProvider, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export interface AiConnection {
  configured: boolean;
  source: "environment" | "saved" | null;
  model: string;
  /** Server URL of the OpenAI-compatible provider; null for hosted providers. */
  baseUrl: string | null;
}

export interface AiSettingsPayload {
  aiProvider: AiProviderId;
  aiConfigured: boolean;
  aiModel: string;
  aiConnections: Record<AiProvider, AiConnection>;
  customAiProviders?: (CustomAiProvider & AiConnection)[];
}

export const isAiProvider = (value: unknown): value is AiProvider =>
  typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);

export const isCustomAiProviderId = (value: unknown): value is CustomAiProviderId =>
  typeof value === "string" && /^custom:[a-f0-9-]{36}$/.test(value);

export const isAiProviderId = (value: unknown): value is AiProviderId =>
  isAiProvider(value) || isCustomAiProviderId(value);
