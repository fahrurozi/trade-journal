import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Trade } from "@luxalgo/broker-sdk";
import { BITGET_HOST, bitgetDnsFallback, isBitgetConnectionFailure } from "./bitget-network";

export const bitgetBroker = {
  id: "bitget",
  displayName: "Bitget",
  credentials: [
    { key: "apiKey", label: "API key", secret: true },
    { key: "apiSecret", label: "API secret", secret: true },
    { key: "passphrase", label: "API passphrase", secret: true },
    {
      key: "market",
      label: "Market",
      secret: false,
      choices: [
        { value: "spot", label: "Classic spot (USDT pairs)" },
        { value: "USDT-FUTURES", label: "Classic USDT-M futures" },
        { value: "USDC-FUTURES", label: "Classic USDC-M futures" },
      ],
    },
  ],
  readOnlySetup:
    "Create an HMAC API key with read-only trade history access. Connect a separate journal account for each market. Sync reads recent fills (up to 90 days). Spot imports USDT pairs. Fees paid in a third token are omitted.",
};

interface Fee {
  feeCoin?: string;
  totalFee?: string;
}

interface Fill {
  tradeId: string;
  symbol: string;
  side: string;
  priceAvg?: string;
  size?: string;
  price?: string;
  baseVolume?: string;
  tradeSide?: string;
  posMode?: string;
  cTime: string;
  feeDetail?: Fee | Fee[];
}

const DAY = 86_400_000;
const PAGE_SIZE = 100;

function normalizeFill(fill: Fill, spot: boolean, quote: string): Trade | null {
  if (typeof fill.symbol !== "string") return null;
  const symbol = fill.symbol.toUpperCase();
  if (!symbol.endsWith(quote) || symbol.length === quote.length) return null;
  const reportedSide = fill.side?.toLowerCase();
  if (reportedSide !== "buy" && reportedSide !== "sell") return null;
  const price = Number(spot ? fill.priceAvg : fill.price);
  const quantity = Number(spot ? fill.size : fill.baseVolume);
  const time = Number(fill.cTime);
  const date = new Date(time < 1e12 ? time * 1000 : time);
  if (![price, quantity].every((value) => Number.isFinite(value) && value > 0)) return null;
  if (time <= 0 || !Number.isFinite(date.getTime())) return null;
  const effect = spot ? "" : (fill.tradeSide ?? "").toLowerCase();
  const hedge = !spot && fill.posMode === "hedge_mode";
  const side = effect.endsWith("_close_long")
    ? "sell"
    : effect.endsWith("_close_short")
      ? "buy"
      : reportedSide;
  const closing = effect === "close" || /close_|^(reduce|burst|delivery|dte_sys_adl)_/.test(effect);
  const positionEffect = closing ? "close" : effect === "open" ? "open" : undefined;
  const positionSide = hedge ? ((side === "buy") !== closing ? "long" : "short") : undefined;
  const fees = Array.isArray(fill.feeDetail)
    ? fill.feeDetail
    : fill.feeDetail
      ? [fill.feeDetail]
      : [];
  const base = symbol.slice(0, -quote.length);
  const fee = fees.reduce((sum, { feeCoin, totalFee }) => {
    const amount = -Number(totalFee);
    if (!Number.isFinite(amount)) return sum;
    if (feeCoin?.toUpperCase() === quote) return sum + amount;
    if (feeCoin?.toUpperCase() === base) return sum + amount * price;
    return sum;
  }, 0);

  return {
    symbol,
    side,
    price,
    quantity,
    fee,
    positionEffect,
    positionSide,
    assetClass: spot ? "crypto" : "futures",
    executedAt: date.toISOString(),
  };
}

export async function fetchBitgetHistory(
  credentials: Record<string, string>,
  historySince?: string,
  request: typeof fetch = fetch,
) {
  const apiKey = credentials.apiKey?.trim();
  const apiSecret = credentials.apiSecret?.trim();
  const passphrase = credentials.passphrase?.trim();
  if (!apiKey || !apiSecret || !passphrase)
    throw new Error("Bitget API key, secret and passphrase are required.");
  const market = credentials.market ?? "spot";
  const spot = market === "spot";
  if (!spot && market !== "USDT-FUTURES" && market !== "USDC-FUTURES") {
    throw new Error("Choose a supported Bitget Classic market.");
  }
  const quote = market === "USDC-FUTURES" ? "USDC" : "USDT";
  const path = spot ? "/api/v2/spot/trade/fills" : "/api/v2/mix/order/fill-history";
  const now = Date.now();
  const start = Math.max(now - 90 * DAY + 60000, historySince ? Date.parse(historySince) : 0);
  const interval = (spot ? 90 : 7) * DAY;
  const seen = new Set<string>();
  const trades: Trade[] = [];
  let skipped = 0;
  let previousRequest = 0;
  let useDnsFallback = false;
  const requestPage = async (target: string) => {
    if (previousRequest) await delay(Math.max(0, 125 - (Date.now() - previousRequest)));
    previousRequest = Date.now();
    const timestamp = String(previousRequest);
    const signature = createHmac("sha256", apiSecret)
      .update(`${timestamp}GET${target}`)
      .digest("base64");
    const options = {
      headers: {
        "ACCESS-KEY": apiKey,
        "ACCESS-SIGN": signature,
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": passphrase,
        locale: "en-US",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      ...(useDnsFallback ? { dispatcher: bitgetDnsFallback } : {}),
    } as const;
    return request(`https://${BITGET_HOST}${target}`, options);
  };

  for (let from = start; from < now; from += interval) {
    const query = new URLSearchParams({
      startTime: String(from),
      endTime: String(Math.min(from + interval, now)),
      limit: String(PAGE_SIZE),
      ...(!spot ? { productType: market } : {}),
    });
    const cursors = new Set<string>();
    while (true) {
      const target = `${path}?${query}`;
      const response = await requestPage(target).catch((error: unknown) => {
        if (useDnsFallback || !isBitgetConnectionFailure(error)) throw error;
        useDnsFallback = true;
        return requestPage(target);
      });
      if (!response.ok) throw new Error(`Bitget history request failed (HTTP ${response.status}).`);
      const body = (await response.json()) as {
        code?: string;
        data?: Fill[] | { fillList?: Fill[] | null; endId?: string };
      };
      if (body.code !== "00000") {
        const code = /^\d{5}$/.test(body.code ?? "") ? ` (code ${body.code})` : "";
        throw new Error(
          `Bitget rejected the history request${code}. Check the key, passphrase and permissions.`,
        );
      }
      const details = Array.isArray(body.data) ? undefined : body.data;
      const rows = spot ? body.data : (details?.fillList ?? (details ? [] : undefined));
      if (!Array.isArray(rows)) throw new Error("Unexpected Bitget fill response.");
      for (const fill of rows) {
        if (!fill?.tradeId) throw new Error("Bitget returned a fill without a trade ID.");
        if (seen.has(fill.tradeId)) continue;
        seen.add(fill.tradeId);
        const trade = normalizeFill(fill, spot, quote);
        if (trade) trades.push(trade);
        else skipped++;
      }
      if (rows.length < PAGE_SIZE) break;
      const cursor = spot ? rows.at(-1)?.tradeId : details?.endId;
      if (!cursor || cursors.has(cursor))
        throw new Error("Bitget fill pagination stopped unexpectedly.");
      cursors.add(cursor);
      query.set("idLessThan", cursor);
    }
  }
  trades.sort((a, b) => a.executedAt!.localeCompare(b.executedAt!));
  return { trades, skipped };
}
