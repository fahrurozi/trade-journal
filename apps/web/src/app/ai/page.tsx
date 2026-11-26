"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Settings2, Zap } from "lucide-react";
import type { AnalysisFilters } from "@luxalgo/journal-core";
import { AiSettings } from "@/components/ai-settings";
import { AiNotice } from "@/components/ai-notice";
import { FileImport } from "@/components/file-import";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import PromptComposer from "@/components/ui/prompt-composer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AI_PROVIDERS,
  AI_PROVIDER_NAMES,
  type AiProviderId,
  type AiSettingsPayload,
} from "@/lib/ai-settings";
import { postJson, useApi } from "@/lib/use-api";
import { useAiRequest, type AiScope } from "@/lib/use-ai-request";

interface Exchange {
  question: string;
  answer: string;
}

const EXAMPLE_QUESTIONS = [
  "How do I import my first trade?",
  "How do I use the Daily journal?",
  "What does profit factor mean?",
  "Compare my average win with my average loss.",
];

const TOOL_TRIGGER =
  "h-8 w-auto max-w-full rounded-[10px] border-border/70 bg-background/25 px-2.5 text-xs shadow-none";
const isClearCommand = (text: string) => text.toLowerCase() === "/clear";

export default function AiPage() {
  return (
    <Suspense>
      <AiView />
    </Suspense>
  );
}

function AiView() {
  const { values, query, timeZone } = useFilters();
  const { data: settings, refresh } = useApi<AiSettingsPayload>("/api/settings");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providerOverride, setProviderOverride] = useState<AiProviderId>();
  const providers = [
    ...AI_PROVIDERS.map((id) => ({
      id,
      name: AI_PROVIDER_NAMES[id],
      connection: settings?.aiConnections[id],
    })),
    ...(settings?.customAiProviders ?? []).map(({ id, name, ...connection }) => ({
      id,
      name,
      connection,
    })),
  ];
  const available = providers.filter(
    ({ connection }) => connection?.baseUrl || connection?.configured,
  );
  const selected =
    available.find(({ id }) => id === providerOverride) ??
    available.find(({ id }) => id === settings?.aiProvider) ??
    available[0];
  const provider = selected?.id ?? "compatible";
  const connection = selected?.connection;
  return (
    <div className="flex h-[calc(100dvh-var(--journal-header-offset))] min-h-[28rem] flex-col">
      <FilterBar
        title="AI"
        actions={
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 /> AI settings
          </Button>
        }
      />
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>AI settings</DialogTitle>
          <DialogDescription>
            Configure a provider or enter your own OpenAI-compatible API URL and key.
          </DialogDescription>
          <AiSettings
            onSaved={() => {
              refresh();
            }}
          />
        </DialogContent>
      </Dialog>
      <div className="flex min-h-0 flex-1 flex-col">
        <JournalChat
          key={JSON.stringify([timeZone, query, provider, connection?.baseUrl])}
          filters={values}
          timeZone={timeZone}
          provider={provider}
          defaultModel={connection?.model ?? ""}
          providers={
            available.length ? available : [{ id: provider, name: AI_PROVIDER_NAMES.compatible }]
          }
          onProviderChange={setProviderOverride}
          canChat={Boolean(selected)}
        />
      </div>
    </div>
  );
}

function JournalChat({
  filters,
  timeZone,
  provider,
  defaultModel,
  providers,
  onProviderChange,
  canChat,
}: {
  filters: AnalysisFilters;
  timeZone: string;
  provider: AiProviderId;
  defaultModel: string;
  providers: { id: AiProviderId; name: string }[];
  onProviderChange: (provider: AiProviderId) => void;
  canChat: boolean;
}) {
  const { data: modelList, error: modelError } = useApi<{ models: string[] }>(
    canChat
      ? provider === "compatible"
        ? "/api/ai/models"
        : `/api/ai/models?provider=${encodeURIComponent(provider)}`
      : null,
  );
  const [modelOverride, setModelOverride] = useState<string>();
  const model = modelOverride ?? defaultModel;
  const [manualOpen, setManualOpen] = useState(false);
  const [manualModel, setManualModel] = useState("");
  const [modelSaveError, setModelSaveError] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const selectModel = async (value: string) => {
    if (value === "__manual__") {
      setManualModel("");
      setManualOpen(true);
      return;
    }
    setSavingModel(true);
    setModelSaveError("");
    try {
      await postJson("/api/settings", { aiProvider: provider, aiModel: value }, "PATCH");
      setModelOverride(value);
      setManualOpen(false);
    } catch (cause) {
      setModelSaveError(cause instanceof Error ? cause.message : "Could not save this model.");
    } finally {
      setSavingModel(false);
    }
  };
  const models = [...new Set([model, defaultModel, ...(modelList?.models ?? [])].filter(Boolean))];
  const [pending, setPending] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [scope, setScope] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState("");
  const { run, busy, error, reset, dismiss } = useAiRequest();
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [history.length, pending, busy, error]);

  const send = (text: string) => {
    if (isClearCommand(text)) {
      reset();
      setPending("");
      setHistory([]);
      setScope(undefined);
      return;
    }
    if (!text || busy || savingModel || !canChat || !model) return;
    setPending(text);
    void run(
      (signal) =>
        postJson<{ answer: string; scope: AiScope }>(
          "/api/ai/ask",
          {
            question: text,
            filters,
            timeZone,
            modelSelection: { provider, model },
            history: history.slice(-4).map(({ question, answer }) => ({
              question: question.slice(0, 2000),
              answer: answer.slice(0, 3000),
            })),
          },
          "POST",
          signal,
        ),
      ({ answer, scope }) => {
        setScope(scope.label);
        setHistory((current) => [...current, { question: text, answer }]);
        setPending("");
      },
    );
  };

  const hasConversation = history.length > 0 || Boolean(pending);

  return (
    <section
      aria-labelledby="journal-chat-heading"
      data-chat-state={hasConversation ? "active" : "empty"}
      className="relative isolate flex min-h-0 flex-1 flex-col"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 mx-auto max-w-[76rem] bg-[radial-gradient(35%_48%_at_35%_52%,rgb(95_178_242/0.2),transparent),radial-gradient(32%_45%_at_68%_55%,rgb(163_122_231/0.15),transparent)] dark:bg-[radial-gradient(35%_48%_at_35%_52%,rgb(95_178_242/0.16),transparent),radial-gradient(32%_45%_at_68%_55%,rgb(163_122_231/0.13),transparent)]"
      />
      <div
        className={`mx-auto flex min-h-0 w-full max-w-[768px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6 ${hasConversation ? "" : "justify-center overflow-y-auto"}`}
      >
        <header className={hasConversation ? "sr-only" : "space-y-2 text-center"}>
          <h2
            id="journal-chat-heading"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Ask your journal
          </h2>
          <p className="text-sm text-muted-foreground">
            Ask about your trades or get help using Trade Journal.
          </p>
        </header>
        {!canChat && (
          <p className="text-xs text-muted-foreground">
            Configure a provider in AI settings to start chatting.
          </p>
        )}
        {modelError && (
          <p role="status" className="text-xs text-muted-foreground">
            {modelError} Enter a model ID in the chat model picker.
          </p>
        )}
        {modelSaveError && (
          <p role="alert" className="text-xs text-destructive">
            {modelSaveError}
          </p>
        )}
        {scope && <p className="shrink-0 text-xs text-muted-foreground">{scope}</p>}
        <div
          ref={transcript}
          role="log"
          aria-label="Journal chat"
          className={hasConversation ? "min-h-0 flex-1 space-y-4 overflow-y-auto pb-2" : "sr-only"}
        >
          {history.map(({ question, answer }, index) => (
            <div key={index} className="space-y-2">
              <p className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl bg-accent px-4 py-2.5 text-sm sm:max-w-[85%]">
                {question}
              </p>
              <p className="whitespace-pre-wrap break-words rounded-2xl border bg-card/70 px-4 py-3 text-sm leading-relaxed">
                {answer}
              </p>
            </div>
          ))}
          {pending && (
            <p className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl bg-accent px-4 py-2.5 text-sm sm:max-w-[85%]">
              {pending}
            </p>
          )}
          {busy && (
            <div role="status" aria-label="Waiting for AI" className="w-fit">
              <div
                aria-hidden="true"
                className="flex items-center gap-1.5 rounded-2xl border bg-card px-4 py-3 text-muted-foreground"
              >
                <i className="size-1.5 rounded-full bg-current motion-safe:animate-bounce" />
                <i className="size-1.5 rounded-full bg-current motion-safe:animate-bounce [animation-delay:120ms]" />
                <i className="size-1.5 rounded-full bg-current motion-safe:animate-bounce [animation-delay:240ms]" />
              </div>
            </div>
          )}
          {error && <AiNotice error={error} onRetry={() => send(pending)} onDismiss={dismiss} />}
        </div>
        {importResult && (
          <p role="status" className="text-sm">
            {importResult}
          </p>
        )}
        <PromptComposer
          prompts={EXAMPLE_QUESTIONS}
          placeholder="Ask a question or type /clear"
          maxLength={10000}
          disabled={busy || savingModel || !canChat || !model}
          allowCommand={isClearCommand}
          onSubmit={send}
          onAttach={() => setImportOpen(true)}
          controls={
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <OptionSelect
                aria-label="Chat provider"
                className={TOOL_TRIGGER}
                value={provider}
                disabled={busy || savingModel}
                onValueChange={(value) => onProviderChange(value as AiProviderId)}
              >
                {providers.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </OptionSelect>
              <Select
                value={model}
                disabled={busy || savingModel || !canChat}
                onValueChange={selectModel}
              >
                <SelectTrigger
                  aria-label="Chat model"
                  className={`${TOOL_TRIGGER} sm:max-w-[18rem]`}
                >
                  <Zap className="size-3 shrink-0 text-brand" aria-hidden="true" />
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent side="top" align="start">
                  {models.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                  <SelectItem value="__manual__">Enter model ID…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
        <Dialog open={manualOpen} onOpenChange={setManualOpen}>
          <DialogContent>
            <DialogTitle>Enter a model ID</DialogTitle>
            <DialogDescription>Use the model ID listed by your provider.</DialogDescription>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void selectModel(manualModel.trim());
              }}
            >
              <Input
                aria-label="Model ID"
                value={manualModel}
                maxLength={200}
                onChange={(event) => setManualModel(event.target.value)}
              />
              {modelSaveError && (
                <p role="alert" className="text-xs text-destructive">
                  {modelSaveError}
                </p>
              )}
              <Button disabled={savingModel || !manualModel.trim()} type="submit">
                Use model
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogTitle>Import a trading statement</DialogTitle>
            <DialogDescription>
              Preview the extracted trades and choose an account before importing.
            </DialogDescription>
            <FileImport
              aiDefault
              onImported={(message) => {
                setImportResult(message);
                setImportOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
