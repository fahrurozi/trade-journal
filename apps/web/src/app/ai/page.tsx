"use client";

import { Suspense, useState } from "react";
import { Paperclip, Send, Settings2 } from "lucide-react";
import type { AnalysisFilters } from "@luxalgo/journal-core";
import { AiSettings } from "@/components/ai-settings";
import { AiNotice } from "@/components/ai-notice";
import { FileImport } from "@/components/file-import";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
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
      <div className="mx-auto max-w-3xl p-4">
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
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState("");
  const [history, setHistory] = useState<Exchange[]>([]);
  const [scope, setScope] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState("");
  const { run, busy, error, dismiss } = useAiRequest();

  const send = (text: string) => {
    if (!text || busy || !canChat || !model) return;
    setPending(text);
    setQuestion("");
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ask your journal</CardTitle>
        <p className="text-xs text-muted-foreground">
          Chat about trades in the selected accounts and date range, or attach a statement to
          import. Changing filters starts a new chat.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <OptionSelect
            aria-label="Chat provider"
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
          <OptionSelect
            aria-label="Chat model"
            value={model}
            disabled={busy || !models.length}
            onValueChange={setModelOverride}
          >
            {!model && <option value="">Choose a model</option>}
            {models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </OptionSelect>
        </div>
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
        <div role="log" aria-label="Journal chat" className="space-y-3">
          {history.map(({ question, answer }, index) => (
            <div key={index} className="space-y-2">
              <p className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-lg bg-accent px-3 py-2 text-sm">
                {question}
              </p>
              <p className="whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-sm leading-relaxed">
                {answer}
              </p>
            </div>
          ))}
          {pending && (
            <p className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-lg bg-accent px-3 py-2 text-sm">
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
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            send(question.trim());
          }}
        >
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Attach a trading statement"
            title="Attach a trading statement"
            onClick={() => setImportOpen(true)}
          >
            <Paperclip />
          </Button>
          <Input
            aria-label="Message"
            placeholder="Ask about your trades"
            maxLength={10000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button type="submit" disabled={busy || !question.trim() || !canChat || !model}>
            <Send /> Send
          </Button>
        </form>
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
      </CardContent>
    </Card>
  );
}
