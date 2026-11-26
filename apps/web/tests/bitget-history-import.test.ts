import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/server/bitget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/bitget")>()),
  fetchBitgetHistory: vi.fn(),
}));

const scratch = mkdtempSync(join(tmpdir(), "journal-bitget-backfill-"));
const originalDir = process.env.JOURNAL_DATA_DIR;
process.env.JOURNAL_DATA_DIR = scratch;
vi.stubEnv("JOURNAL_PASSWORD", "");
const { db, executions } = await import("../src/db");
const { POST: create } = await import("../src/app/api/accounts/route");
const { POST: action } = await import("../src/app/api/accounts/[id]/actions/route");
const { POST: upload } = await import("../src/app/api/import/route");
const { fetchBitgetHistory } = await import("../src/server/bitget");

const request = (body: unknown) =>
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

it("adds archived Bitget orders without overlapping sync and restores a partial hedge close", async () => {
  vi.setSystemTime(new Date("2026-11-26T08:00:00Z"));
  vi.mocked(fetchBitgetHistory).mockResolvedValue({
    skipped: 0,
    trades: [
      {
        symbol: "BTCUSDT",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 0.1,
        executedAt: "2026-10-01T00:00:00.000Z",
        assetClass: "futures",
        positionSide: "long",
        positionEffect: "open",
      },
      {
        symbol: "BTCUSDT",
        side: "sell",
        quantity: 2,
        price: 110,
        fee: 0.2,
        executedAt: "2026-10-02T00:00:00.000Z",
        assetClass: "futures",
        positionSide: "long",
        positionEffect: "close",
      },
    ],
  });
  const created = await create(
    request({
      name: "Bitget",
      kind: "sync",
      broker: "bitget",
      credentials: {
        market: "USDT-FUTURES",
        apiKey: "fixture",
        apiSecret: "fixture",
        passphrase: "fixture",
      },
    }),
  );
  expect(created.status).toBe(200);
  const { id, sync } = await created.json();
  expect(sync).toMatchObject({ inserted: 2, skipped: 1 });
  const before = db
    .select()
    .from(executions)
    .all()
    .find((row) => row.side === "sell")!;
  expect(before.quantity).toBe(1);

  const content = [
    "Trading Pair,Direction,Filled Quantity,Average Price,Order Time,Fee,Order ID",
    "BTC/USDT,Open Long,1,80,2026-08-01 08:00:00,0.07,1",
    "BTC/USDT,Open Long,1,100,2026-10-01 00:00:00,0.1,2",
  ].join("\n");
  const form = { accountId: id, bitgetHistory: true, content, timeZone: "UTC" };
  const preview = await (await upload(request({ ...form, mode: "preview" }))).json();
  expect(preview).toMatchObject({ detected: "bitget-history", totals: { executions: 1 } });
  expect(preview.warnings).toEqual(
    expect.arrayContaining([expect.stringContaining("left to API sync")]),
  );
  const committed = await upload(request({ ...form, mode: "commit" }));
  expect(committed.status).toBe(200);
  expect(await committed.json()).toMatchObject({ inserted: 1, duplicates: 1 });

  const resync = await action(request({ action: "sync", fullHistory: true }), {
    params: Promise.resolve({ id }),
  });
  expect(await resync.json()).toMatchObject({ sync: { inserted: 0, restoredHistoryFills: 1 } });
  const rows = db.select().from(executions).all();
  expect(rows).toHaveLength(3);
  expect(rows.find((row) => row.id === before.id)).toMatchObject({ quantity: 2, fee: 0.2 });
  expect(rows.find((row) => row.source === "import")).toMatchObject({
    fee: 0.07,
    assetClass: "futures",
  });
  const repeated = await upload(request({ ...form, mode: "commit" }));
  expect(await repeated.json()).toMatchObject({ inserted: 0, duplicates: 2 });
});

afterAll(() => {
  db.$client.close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});
