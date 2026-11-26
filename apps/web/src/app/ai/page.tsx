"use client";

import { Suspense, useState } from "react";
import { Settings2, Zap } from "lucide-react";
import type { AnalysisFilters } from "@luxalgo/journal-core";
import { AiSettings } from "@/components/ai-settings";
import { AiNotice } from "@/components/ai-notice";
import { FileImport } from "@/components/file-import";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
  type AiProvider,
  type AiSettingsPayload,
} from "@/lib/ai-settings";
import { postJson, useApi } from "@/lib/use-api";
import { useAiRequest, type AiScope } from "@/lib/use-ai-request";

interface Exchange {
  question: string;
  answer: string;
}

const EXAMPLE_QUESTIONS = [
  "What was my most expensive trading mistake?",
  "Which setups were most profitable in this date range?",
  "How does my win rate change by time of day?",
  "Compare my average win with my average loss.",
];

const TOOL_TRIGGER =
  "h-8 w-auto max-w-full rounded-[10px] border-border/70 bg-background/25 px-2.5 text-xs shadow-none";

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
  const [providerOverride, setProviderOverride] = useState<AiProvider>();
  const provider = providerOverride ?? settings?.aiProvider ?? "compatible";
  const connection = settings?.aiConnections[provider];
  return (
    <>
      <FilterBar
        title="AI"
        actions={
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 /> AI settings
          </Button>
        }
      />
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle>AI settings</DialogTitle>
          <DialogDescription>
            Configure a provider or enter your own OpenAI-compatible API URL and key.
          </DialogDescription>
          <AiSettings
            onSaved={() => {
              setProviderOverride(undefined);
              refresh();
            }}
          />
        </DialogContent>
      </Dialog>
      <div className="p-4 sm:p-6">
        <JournalChat
          key={JSON.stringify([timeZone, query, provider, connection?.baseUrl])}
          filters={values}
          timeZone={timeZone}
          provider={provider}
          defaultModel={connection?.model ?? ""}
          providers={AI_PROVIDERS.filter(
            (id) => id === provider || settings?.aiConnections[id].configured,
          )}
          onProviderChange={setProviderOverride}
          canChat={Boolean(connection?.configured)}
        />
      </div>
    </>
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
  provider: AiProvider;
  defaultModel: string;
  providers: AiProvider[];
  onProviderChange: (provider: AiProvider) => void;
  canChat: boolean;
}) {
  const { data: modelList, error: modelError } = useApi<{ models: string[] }>(
    provider === "compatible" && canChat ? "/api/ai/models" : null,
  );
  const [modelOverride, setModelOverride] = useState<string>();
  const model = modelOverride ?? defaultModel;
  const models = [...new Set([defaultModel, ...(modelList?.models ?? [])].filter(Boolean))];
  const [pending, setPending] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [scope, setScope] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState("");
  const { run, busy, error, dismiss } = useAiRequest();

  const send = (text: string) => {
    if (!text || busy || !canChat || !model) return;
    setPending(text);
    void run(
      () =>
        postJson<{ answer: string; scope: AiScope }>("/api/ai/ask", {
          question: text,
          filters,
          timeZone,
          modelSelection: { provider, model },
          history: history.slice(-4).map(({ question, answer }) => ({
            question: question.slice(0, 2000),
            answer: answer.slice(0, 3000),
          })),
        }),
      ({ answer, scope }) => {
        setScope(scope.label);
        setHistory((current) => [...current, { question: text, answer }]);
        setPending("");
      },
    );
  };

  const hasConversation = history.length > 0 || Boolean(pending);

  return (
    <section aria-labelledby="journal-chat-heading" className="relative isolate">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-[36rem] max-w-[76rem] bg-[radial-gradient(35%_48%_at_35%_52%,rgb(95_178_242/0.2),transparent),radial-gradient(32%_45%_at_68%_55%,rgb(163_122_231/0.15),transparent)] dark:bg-[radial-gradient(35%_48%_at_35%_52%,rgb(95_178_242/0.16),transparent),radial-gradient(32%_45%_at_68%_55%,rgb(163_122_231/0.13),transparent)]"
      />
      <div className="mx-auto w-full max-w-[720px] space-y-4 pb-10 pt-6 sm:pt-10">
        <header
          className={
            hasConversation
              ? "space-y-1"
              : "space-y-2 pb-3 pt-8 text-center sm:pt-[clamp(3.5rem,13vh,9rem)]"
          }
        >
          <h2
            id="journal-chat-heading"
            className={
              hasConversation
                ? "text-lg font-semibold"
                : "text-3xl font-semibold tracking-tight sm:text-4xl"
            }
          >
            Ask your journal
          </h2>
          <p className="text-sm text-muted-foreground">
            Chat about trades in the selected accounts and date range. Changing filters starts a new
            chat.
          </p>
        </header>
        {!canChat && (
          <p className="text-xs text-muted-foreground">
            Configure a provider in AI settings to start chatting.
          </p>
        )}
        {modelError && (
          <p role="status" className="text-xs text-muted-foreground">
            {modelError} You can use the saved model.
          </p>
        )}
        {scope && <p className="text-xs text-muted-foreground">{scope}</p>}
        <div role="log" aria-label="Journal chat" className="space-y-4">
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
          {busy && <p className="text-xs text-muted-foreground">Thinking…</p>}
        </div>
        {error && <AiNotice error={error} onRetry={() => send(pending)} onDismiss={dismiss} />}
        {importResult && (
          <p role="status" className="text-sm">
            {importResult}
          </p>
        )}
        <PromptComposer
          prompts={EXAMPLE_QUESTIONS}
          placeholder="Ask about your trades…"
          maxLength={10000}
          disabled={busy || !canChat || !model}
          onSubmit={send}
          onAttach={() => setImportOpen(true)}
          controls={
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <OptionSelect
                aria-label="Chat provider"
                className={TOOL_TRIGGER}
                value={provider}
                disabled={busy}
                onValueChange={(value) => onProviderChange(value as AiProvider)}
              >
                {providers.map((id) => (
                  <option key={id} value={id}>
                    {AI_PROVIDER_NAMES[id]}
                  </option>
                ))}
              </OptionSelect>
              <Select
                value={model}
                disabled={busy || !models.length}
                onValueChange={setModelOverride}
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
                </SelectContent>
              </Select>
            </div>
          }
        />
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
