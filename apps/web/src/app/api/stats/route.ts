import {
  readFilters,
  byDirection,
  byDuration,
  byHour,
  byMistake,
  byPlaybook,
  bySymbol,
  byTag,
  byWeekday,
  calendarMonthFromDays,
  computeEdgeScore,
  computeOverview,
  dailyCumulativeFromDays,
  dayKeyOf,
  type AnnotatedTrade,
} from "@luxalgo/journal-core";
import { asc, inArray } from "drizzle-orm";
import { accounts, db, executions, playbooks } from "@/db";
import { calendarRunningPnl } from "@/lib/calendar-insights";
import { handler, ok } from "@/server/api";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades, type TradeFilters } from "@/server/trades-query";

/** Count and sum only the sells inside the selected period, even when the position opened earlier. */
function openSpotSales(trades: AnnotatedTrade[], filters: TradeFilters, timeZone: string) {
  const exits = trades.flatMap((trade) => trade.exits);
  const ids = [...new Set(exits.map((exit) => exit.executionId))];
  let eligible = new Set(ids);
  if (filters.from || filters.to) {
    eligible = new Set();
    for (let offset = 0; offset < ids.length; offset += 500) {
      const dates = db
        .select({ id: executions.id, time: executions.executedAt })
        .from(executions)
        .where(inArray(executions.id, ids.slice(offset, offset + 500)))
        .all();
      for (const { id, time } of dates) {
        const day = dayKeyOf(time, timeZone);
        if ((!filters.from || day >= filters.from) && (!filters.to || day <= filters.to))
          eligible.add(id);
      }
    }
  }
  return {
    fills: eligible.size,
    grossPnl: exits.reduce(
      (pnl, exit) => pnl + (eligible.has(exit.executionId) ? exit.grossPnl : 0),
      0,
    ),
  };
}

/** The entire dashboard in one request. */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const timeZone = getTimeZone();
  const filters: TradeFilters = readFilters(url.searchParams);

  const { trades: originalTrades } = queryTrades(filters);
  const accountRows = db.select().from(accounts).orderBy(asc(accounts.createdAt)).all();
  const selected = filters.accounts
    ? accountRows.filter((a) =>
        filters
          .accounts!.split(",")
          .map((id) => id.trim())
          .includes(a.id),
      )
    : accountRows;
  const conversion = getCurrencyConversion();
  const {
    trades,
    initialBalance,
    scope: currencyScope,
  } = currencyProjection(originalTrades, selected, conversion);

  const { metrics, days, equity } = computeOverview(trades, { timeZone, initialBalance });
  const accountCurrencies = new Map(accountRows.map((a) => [a.id, a.currency]));
  const bitgetAccounts = new Set(
    selected.filter((account) => account.broker === "bitget").map((account) => account.id),
  );
  let bitgetOpenSales = null;
  if (
    currencyScope.monetary &&
    bitgetAccounts.size > 0 &&
    (!filters.status || filters.status === "open") &&
    (!filters.assetClass || filters.assetClass === "crypto")
  ) {
    const openSpotTrades =
      filters.from || filters.to
        ? currencyProjection(
            queryTrades({
              ...filters,
              accounts: [...bitgetAccounts].join(","),
              from: undefined,
              to: undefined,
              status: "open",
              assetClass: "crypto",
            }).trades,
            selected,
            conversion,
          ).trades
        : trades.filter(
            (trade) =>
              bitgetAccounts.has(trade.accountId) &&
              trade.assetClass === "crypto" &&
              trade.status === "open",
          );
    bitgetOpenSales = openSpotSales(
      openSpotTrades.filter((trade) => trade.direction === "long"),
      filters,
      timeZone,
    );
  }

  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const calendarYear = Number(url.searchParams.get("calYear") ?? today.slice(0, 4));
  const calendarMonthNum = Number(url.searchParams.get("calMonth") ?? today.slice(5, 7));
  const calendarPrefix = `${calendarYear}-${String(calendarMonthNum).padStart(2, "0")}`;
  const calendarTrades = trades.filter(
    (trade) =>
      trade.status !== "open" &&
      trade.closedAt &&
      dayKeyOf(trade.closedAt, timeZone).startsWith(calendarPrefix),
  );
  return ok({
    timeZone,
    currencies: currencyScope.monetary
      ? [currencyScope.currency ?? "USD"]
      : currencyScope.sourceCurrencies,
    currencyScope,
    currencyGroups: currencyScope.monetary
      ? []
      : currencyScope.sourceCurrencies.map((currency) => {
          const groupAccounts = selected.filter((account) => account.currency === currency);
          const groupTrades = originalTrades.filter(
            (trade) => accountCurrencies.get(trade.accountId) === currency,
          );
          return {
            currency,
            metrics: computeOverview(groupTrades, {
              timeZone,
              initialBalance: groupAccounts.reduce(
                (sum, account) => sum + account.initialBalance,
                0,
              ),
            }).metrics,
          };
        }),
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name })),
    playbooks: db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all(),
    metrics: currencyScope.monetary ? metrics : null,
    edgeScore: currencyScope.monetary ? computeEdgeScore(metrics) : null,
    days,
    dailyCumulative: dailyCumulativeFromDays(days),
    equity,
    calendar: calendarMonthFromDays(days, calendarYear, calendarMonthNum),
    calendarCurrencies: currencyScope.monetary
      ? [currencyScope.currency ?? "USD"]
      : currencyScope.sourceCurrencies,
    runningPnl: currencyScope.monetary ? calendarRunningPnl(calendarTrades, timeZone) : {},
    buckets: {
      symbol: bySymbol(trades).slice(0, 20),
      tag: byTag(trades),
      mistake: byMistake(trades),
      playbook: byPlaybook(trades),
      weekday: byWeekday(trades, timeZone),
      hour: byHour(trades, timeZone),
      duration: byDuration(trades),
      direction: byDirection(trades),
    },
    openPositions: originalTrades
      .filter((t) => t.status === "open")
      .map((t) => ({
        key: t.key,
        symbol: t.symbol,
        direction: t.direction,
        openedAt: t.openedAt,
        quantity: t.openQuantity,
        avgEntry: t.avgEntry,
        currency: accountCurrencies.get(t.accountId) ?? "USD",
      })),
    recentTrades: [...(currencyScope.monetary ? trades : originalTrades)]
      .filter((t) => t.status !== "open")
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
      .slice(0, 10)
      .map((t) => ({
        key: t.key,
        symbol: t.symbol,
        closedAt: t.closedAt,
        netPnl: t.netPnl,
        currency: currencyScope.monetary
          ? (currencyScope.currency ?? "USD")
          : (accountCurrencies.get(t.accountId) ?? "USD"),
        status: t.status,
      })),
    initialBalance,
    bitgetOpenSales,
  });
});
