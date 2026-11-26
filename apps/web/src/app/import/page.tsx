"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FileUp, Landmark, PencilLine } from "lucide-react";
import { ManualTradeEntry } from "@/components/manual-trade-entry";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OptionSelect } from "@/components/ui/option-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postJson, useApi } from "@/lib/use-api";
import { isTimeZone } from "@/lib/timezone";
import { FileImport } from "@/components/file-import";

interface BrokerInfo {
  id: string;
  displayName: string;
  credentials: {
    key: string;
    label: string;
    secret?: boolean;
    choices?: { value: string; label: string }[];
  }[];
  readOnlySetup: string;
}

export default function ImportPage() {
  return (
    <Suspense>
      <ImportView />
    </Suspense>
  );
}

function ImportView() {
  const router = useRouter();
  const bitgetAccount = useSearchParams().get("bitgetAccount");
  return (
    <div>
      <FilterBar title="Import trades" />
      <div className="mx-auto max-w-3xl p-4">
        {bitgetAccount ? (
          <BitgetHistory key={bitgetAccount} accountId={bitgetAccount} />
        ) : (
          <Tabs defaultValue="file">
            <TabsList>
              <TabsTrigger value="file" className="max-sm:px-2 max-sm:text-xs">
                <FileUp className="mr-1.5 hidden h-4 w-4 min-[420px]:block" />
                File upload
              </TabsTrigger>
              <TabsTrigger value="sync" className="max-sm:px-2 max-sm:text-xs">
                <Landmark className="mr-1.5 hidden h-4 w-4 min-[420px]:block" />
                Broker sync
              </TabsTrigger>
              <TabsTrigger value="manual" className="max-sm:px-2 max-sm:text-xs">
                <PencilLine className="mr-1.5 hidden h-4 w-4 min-[420px]:block" />
                Manual
              </TabsTrigger>
            </TabsList>
            <TabsContent value="file">
              <FileImport />
            </TabsContent>
            <TabsContent value="sync">
              <BrokerConnect />
            </TabsContent>
            <TabsContent value="manual">
              <Card>
                <CardHeader>
                  <CardTitle>Add executions manually</CardTitle>
                </CardHeader>
                <CardContent>
                  <ManualTradeEntry onSaved={() => router.push("/trades")} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

function BrokerConnect() {
  const router = useRouter();
  const { data } = useApi<{ brokers: BrokerInfo[] }>("/api/brokers");
  const { data: settingsData, error: settingsError } = useApi<{ importTimeZone: string }>(
    "/api/settings",
  );
  const [brokerId, setBrokerId] = useState("");
  const [name, setName] = useState("");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bitgetSetup, setBitgetSetup] = useState<{
    id: string;
    inserted: number;
    skippedReasons: string[];
  }>();
  const broker = data?.brokers.find((b) => b.id === brokerId) ?? null;

  const connect = async () => {
    if (!broker) return;
    setBusy(true);
    setError(null);
    try {
      const created = await postJson<{
        id: string;
        sync: { inserted: number; skipped: number; skippedReasons: string[] };
      }>("/api/accounts", {
        name: name || broker.displayName,
        kind: "sync",
        broker: broker.id,
        credentials,
      });
      if (broker.id === "bitget") {
        setCredentials({});
        setBitgetSetup({
          id: created.id,
          inserted: created.sync.inserted,
          skippedReasons: created.sync.skippedReasons,
        });
        return;
      }
      if (created.sync.skipped > 0) {
        alert(
          `${created.sync.skipped} broker record(s) were skipped: ${created.sync.skippedReasons.join(" ")}`,
        );
      }
      router.push(`/?accounts=${encodeURIComponent(created.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  if (bitgetSetup) return <BitgetHistory accountId={bitgetSetup.id} setup={bitgetSetup} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a broker (read-only keys, stored encrypted on YOUR machine)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">Broker / exchange</Label>
          <Select
            value={brokerId}
            onValueChange={(value) => {
              setBrokerId(value);
              setCredentials({});
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a broker" />
            </SelectTrigger>
            <SelectContent>
              {data?.brokers.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {broker && (
          <>
            <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
              {broker.readOnlySetup}
            </p>
            {broker.id === "ibkr-flex" && (
              <p className="text-xs text-muted-foreground">
                {settingsError
                  ? "Could not load the import timezone. Refresh and try again."
                  : settingsData
                    ? `Statement timezone: ${settingsData.importTimeZone}. Used for Flex timestamps without an offset, and required for Flex XML files uploaded into this account. Change it in Settings → Journal before connecting.`
                    : "Loading statement timezone…"}
              </p>
            )}
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">Account name</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={broker.displayName}
              />
            </div>
            {broker.credentials.map((field) => (
              <div key={field.key}>
                <Label className="mb-1 block text-xs text-muted-foreground">{field.label}</Label>
                {field.choices ? (
                  <OptionSelect
                    aria-label={field.label}
                    value={credentials[field.key] ?? ""}
                    onValueChange={(value) => setCredentials((c) => ({ ...c, [field.key]: value }))}
                  >
                    <option value="" disabled>
                      Choose a market
                    </option>
                    {field.choices.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </OptionSelect>
                ) : (
                  <Input
                    aria-label={field.label}
                    type={field.secret ? "password" : "text"}
                    value={credentials[field.key] ?? ""}
                    onChange={(event) =>
                      setCredentials((c) => ({ ...c, [field.key]: event.target.value }))
                    }
                    autoComplete="off"
                  />
                )}
              </div>
            ))}
            {error && <p className="text-sm text-loss">{error}</p>}
            <Button
              onClick={connect}
              disabled={
                busy ||
                broker.credentials.some(
                  (field) => !/optional/i.test(field.label) && !credentials[field.key]?.trim(),
                ) ||
                (broker.id === "ibkr-flex" && !isTimeZone(settingsData?.importTimeZone))
              }
            >
              {broker.id === "bitget"
                ? busy
                  ? "Connecting and importing…"
                  : "Connect & import recent history"
                : busy
                  ? "Connecting…"
                  : "Connect & sync"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BitgetHistory({
  accountId,
  setup,
}: {
  accountId: string;
  setup?: { inserted: number; skippedReasons: string[] };
}) {
  const { data, error } = useApi<{
    accounts: {
      id: string;
      name: string;
      broker: string;
      connected: boolean;
      archivedAt: string | null;
    }[];
  }>("/api/accounts");
  const account = data?.accounts.find(
    (row) => row.id === accountId && row.broker === "bitget" && row.connected && !row.archivedAt,
  );
  const [message, setMessage] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);

  async function syncHistory() {
    setSyncing(true);
    setSyncFailed(false);
    setSyncMessage("");
    try {
      const { sync } = await postJson<{
        sync: { inserted: number; restoredHistoryFills?: number; skippedReasons: string[] };
      }>(`/api/accounts/${encodeURIComponent(accountId)}/actions`, {
        action: "sync",
        fullHistory: true,
      });
      setSyncMessage(
        `Recent history synced. ${sync.inserted} new fills.${sync.restoredHistoryFills ? ` ${sync.restoredHistoryFills} partial fills restored.` : ""} ${sync.skippedReasons.join(" ")}`,
      );
    } catch (error) {
      setSyncFailed(true);
      setSyncMessage(error instanceof Error ? error.message : "Bitget history sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  if (!account)
    return (
      <p role={data || error ? "alert" : "status"} className="text-sm">
        {error ??
          (data ? "Select an active Bitget account in Accounts." : "Loading Bitget account…")}
      </p>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bitget history</CardTitle>
          <p className="text-sm text-muted-foreground">{account.name}</p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          {setup && (
            <p role="status">
              Account connected. {setup.inserted} fills imported from the available API history.{" "}
              {setup.skippedReasons.join(" ")}
            </p>
          )}
          <p>
            Bitget sync covers up to 90 days. For earlier trades, upload a CSV for the same market.
            Overlapping rows are left to sync.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/trades?range=all&accounts=${encodeURIComponent(accountId)}`}>
                View all trades
              </Link>
            </Button>
            <Button variant="outline" disabled={syncing} onClick={() => void syncHistory()}>
              {syncing
                ? "Syncing recent history…"
                : syncFailed
                  ? "Retry history sync"
                  : "Sync recent history"}
            </Button>
            <a
              className="underline"
              href="https://www.bitget.com/support/articles/12560603824169"
              target="_blank"
              rel="noreferrer"
            >
              Bitget export guide
            </a>
          </div>
          {message && <p role="status">{message}</p>}
          {syncMessage && <p role={syncFailed ? "alert" : "status"}>{syncMessage}</p>}
        </CardContent>
      </Card>
      <FileImport
        bitgetAccountId={accountId}
        onImported={(result) => {
          setMessage(result);
          void syncHistory();
        }}
      />
    </div>
  );
}
