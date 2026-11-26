"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
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
  return (
    <div>
      <FilterBar title="Import trades" />
      <div className="mx-auto max-w-3xl p-4">
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
  const broker = data?.brokers.find((b) => b.id === brokerId) ?? null;

  const connect = async () => {
    if (!broker) return;
    setBusy(true);
    setError(null);
    try {
      const created = await postJson<{
        id: string;
        sync: { skipped: number; skippedReasons: string[] };
      }>("/api/accounts", {
        name: name || broker.displayName,
        kind: "sync",
        broker: broker.id,
        credentials,
      });
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
              {busy ? "Connecting…" : "Connect & sync"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
