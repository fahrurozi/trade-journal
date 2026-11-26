"use client";

import { useState } from "react";
import {
  AI_KEY_VARIABLES,
  AI_PROVIDER_NAMES,
  type AiProviderId,
  type AiSettingsPayload,
} from "@/lib/ai-settings";
import { postJson, useApi } from "@/lib/use-api";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";

export function AiSettings({ onSaved }: { onSaved?: () => void } = {}) {
  const { data, error, refresh } = useApi<AiSettingsPayload>("/api/settings");
  const [provider, setProvider] = useState<AiProviderId | "new">("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | "remove">();
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");

  const hosted = provider === "anthropic" || provider === "openai";
  const custom = data?.customAiProviders ?? [];
  const connection =
    provider === "new"
      ? undefined
      : hosted || provider === "compatible"
        ? data?.aiConnections[provider]
        : custom.find(({ id }) => id === provider);
  const environment = connection?.source === "environment";
  const ready = hosted ? Boolean(apiKey.trim() || connection?.source) : Boolean(baseUrl.trim());
  const disabled = Boolean(busy) || !data;

  function selectProvider(next: typeof provider) {
    const profile = custom.find(({ id }) => id === next);
    setProvider(next);
    setApiKey("");
    setName(profile?.name ?? "");
    setBaseUrl(
      profile?.baseUrl ??
        (next === "compatible" ? (data?.aiConnections.compatible.baseUrl ?? "") : ""),
    );
    setFailure("");
    setMessage("");
  }

  async function update(action: NonNullable<typeof busy>) {
    setBusy(action);
    setFailure("");
    setMessage("");
    try {
      if (action === "test") {
        await postJson("/api/ai/models", { provider, baseUrl, apiKey });
        setMessage("Connection successful.");
        return;
      }
      if (hosted) {
        await postJson(
          "/api/settings",
          {
            [`${provider}Key`]: action === "remove" ? null : apiKey.trim(),
          },
          "PATCH",
        );
      } else if (action === "remove") {
        await postJson("/api/ai/connections", { id: provider }, "DELETE");
      } else {
        await postJson("/api/ai/connections", {
          id: provider === "new" ? undefined : provider,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiKey,
        });
      }
      if (provider === "new" || (!hosted && action === "remove")) selectProvider("anthropic");
      setApiKey("");
      setMessage(action === "remove" ? "Removed." : "Provider saved.");
      refresh();
      onSaved?.();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Card id="ai-settings" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>AI providers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Manage provider connections here. Choose a model on the AI page.
        </p>
        <div className="space-y-1">
          <Label htmlFor="ai-provider">Provider</Label>
          <OptionSelect
            id="ai-provider"
            value={provider}
            disabled={disabled}
            onValueChange={(value) => selectProvider(value as typeof provider)}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            {data?.aiConnections.compatible.baseUrl && (
              <option value="compatible">{AI_PROVIDER_NAMES.compatible}</option>
            )}
            {custom.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            <option value="new">Add custom provider</option>
          </OptionSelect>
        </div>
        {!hosted && (
          <>
            {provider !== "compatible" && (
              <div className="space-y-1">
                <Label htmlFor="ai-name">Provider name</Label>
                <Input
                  id="ai-name"
                  value={name}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ai-base-url">Server URL</Label>
              <Input
                id="ai-base-url"
                type="url"
                value={baseUrl}
                disabled={disabled}
                placeholder="http://localhost:11434/v1"
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setMessage("");
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label htmlFor="ai-api-key">{hosted ? "API key" : "API key (optional)"}</Label>
          <Input
            id="ai-api-key"
            type="password"
            value={apiKey}
            disabled={disabled || environment}
            onChange={(event) => {
              setApiKey(event.target.value);
              setMessage("");
            }}
            placeholder={connection?.source ? "Key configured" : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {environment && (
            <p className="text-xs text-muted-foreground">
              Using {AI_KEY_VARIABLES[provider as "openai" | "anthropic"]} from the server
              environment.
            </p>
          )}
          {connection?.source === "saved" && !hosted && (
            <p className="text-xs text-muted-foreground">
              Leave blank to keep the key for this URL. Changing the URL clears the previous key.
            </p>
          )}
        </div>
        {(error || failure) && (
          <p role="alert" className="text-xs text-destructive">
            {failure || error}
          </p>
        )}
        {message && (
          <p role="status" className="text-xs text-profit">
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled || !ready} onClick={() => update("test")}>
            {busy === "test" ? "Testing…" : "Test connection"}
          </Button>
          <Button
            disabled={
              disabled ||
              !ready ||
              (hosted ? !apiKey.trim() : provider !== "compatible" && !name.trim())
            }
            onClick={() => update("save")}
          >
            {busy === "save" ? "Saving…" : "Save provider"}
          </Button>
          {(hosted ? connection?.source === "saved" : Boolean(connection)) && (
            <Button variant="outline" disabled={disabled} onClick={() => update("remove")}>
              {hosted ? "Remove key" : "Remove provider"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
