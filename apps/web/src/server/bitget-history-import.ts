import { eq } from "drizzle-orm";
import { makeFillsFormat, readHeaders, type ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, db } from "@/db";
import { requireValue } from "./api";
import { BITGET_HISTORY_MS } from "./bitget";
import { decryptJson } from "./crypto";

const columns = {
  symbol: ["tradingpair", "pair", "symbol", "contract"],
  side: ["direction", "tradeside", "side"],
  quantity: [
    "filledquantity",
    "filledqty",
    "filledamount",
    "filledvolume",
    "executedquantity",
    "fillqty",
  ],
  price: [
    "averagefillprice",
    "averagefilledprice",
    "averageprice",
    "avgprice",
    "fillprice",
    "filledprice",
  ],
  timestamp: [
    "filltime",
    "filledtime",
    "executiontime",
    "transactiontime",
    "tradetime",
    "updatedtime",
    "ordertime",
    "time",
  ],
  fees: [["tradingfee", "commission", "fee", "fees"]],
  contract: [],
  executionId: ["tradeid", "fillid", "executionid", "orderid"],
};

export const bitgetCsv = makeFillsFormat({
  id: "bitget-history",
  label: "Bitget history CSV",
  columns,
  required: [columns.symbol, columns.side, columns.quantity, columns.price, columns.timestamp],
  rowFilter: (row) =>
    !/^(?:unfilled|rejected|failed|expired|pending|live|new|open)$/i.test(
      row.status || row.orderstatus || "",
    ),
});

export function parseBitgetCsv(content: string, timeZone: string) {
  return bitgetCsv.detect(readHeaders(content), content)
    ? bitgetCsv.parse(content, { timeZone })
    : null;
}

export function bitgetHistoryAccount(accountId: unknown) {
  requireValue(typeof accountId === "string" && accountId, "Select a connected Bitget account.");
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  const credentialsEnc = account?.credentialsEnc;
  requireValue(
    account?.broker === "bitget" &&
      account.kind === "sync" &&
      credentialsEnc &&
      !account.archivedAt,
    "Select an active, connected Bitget account.",
  );
  return { ...account, credentialsEnc };
}

export function reconcileBitgetHistory(
  account: ReturnType<typeof bitgetHistoryAccount>,
  rows: ImportedExecution[],
) {
  const { market } = decryptJson<Record<string, string>>(account.credentialsEnc);
  const spot = !market || market === "spot";
  const quote = market === "USDC-FUTURES" ? "USDC" : "USDT";
  // Use the original connection date so a repeated file import never starts
  // including newer order rows whose component fills were already synced.
  const since = new Date(Date.parse(account.createdAt) - BITGET_HISTORY_MS).toISOString();
  let covered = 0;
  let wrongMarket = 0;
  const executions = rows.flatMap((row) => {
    const symbol = row.symbol.toUpperCase().replace(/[\s/_-]/g, "");
    const { position } = row.importMetadata ?? {};
    if (!symbol.endsWith(quote) || symbol === quote || (spot && position)) {
      wrongMarket++;
      return [];
    }
    if (row.executedAt >= since) {
      covered++;
      return [];
    }
    return [
      {
        ...row,
        symbol,
        assetClass: spot ? ("crypto" as const) : ("futures" as const),
        // Bitget labels hedge fills by position side. Use the same group as API
        // fills so an opening order from the archive can pair with a synced close.
        importMetadata: position
          ? {
              id: row.importMetadata!.id,
              group: `sync-hedge:${position.direction}`,
              order: row.importMetadata!.order,
            }
          : undefined,
      },
    ];
  });
  return {
    executions,
    covered,
    warnings: [
      ...(covered
        ? [
            `${covered} row(s) at or after ${since} were left to API sync to avoid counting orders twice.`,
          ]
        : []),
      ...(wrongMarket
        ? [
            `${wrongMarket} row(s) did not match the account's selected Bitget market or quote currency.`,
          ]
        : []),
    ],
  };
}
