"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types matching FreqTrade API responses ──────────────────────────────────

export type FtBotEntry = { id: string; name: string };

export type FtProfit = {
  profit_closed_coin: number;
  profit_closed_percent: number;
  profit_closed_fiat: number;
  profit_all_coin: number;
  profit_all_percent: number;
  trade_count: number;
  closed_trade_count: number;
  first_trade_date: string;
  latest_trade_date: string;
  avg_duration: string;
  best_pair: string;
  best_rate: number;
  winning_trades: number;
  losing_trades: number;
  profit_factor: number;
  winrate: number;
  expectancy: number;
  sharpe: number;
  sortino: number;
  sqn: number;
  max_drawdown: number;
  max_drawdown_abs: number;
  current_drawdown: number;
  trading_volume: number;
  bot_start_timestamp: number;
};

export type FtConfig = {
  bot_name?: string;
  strategy?: string;
  state?: string;
  runmode?: string;
  exchange?: string;
  stake_currency?: string;
  stake_amount?: number;
  max_open_trades?: number;
  timeframe?: string;
  dry_run?: boolean;
};

export type FtStats = {
  bot_id: string;
  bot_name: string;
  config: FtConfig;
  profit: FtProfit;
  balance_usdt: number;
  free_usdt: number;
  used_usdt: number;
};

export type FtOpenTrade = {
  trade_id: number;
  pair: string;
  open_rate: number;
  current_rate: number;
  profit_pct: number;
  profit_abs: number;
  amount: number;
  stake_amount: number;
  leverage?: number;
  open_date: string;
  trade_duration: string;
  is_short: boolean;
  nr_of_successful_entries?: number;
};

export type FtClosedTrade = {
  trade_id: number;
  pair: string;
  amount?: number;
  open_rate: number;
  close_rate: number;
  profit_pct: number;
  profit_abs: number;
  stake_amount: number;
  leverage?: number;
  is_short?: boolean;
  open_date: string;
  close_date: string;
  sell_reason: string;
  exit_reason?: string;
  close_reason?: string;
  nr_of_successful_entries?: number;
};

export type FtPerformance = {
  pair: string;
  profit: number;
  profit_ratio: number;
  profit_pct?: number;
  profit_abs?: number;
  count: number;
};

export type FtDailyRow = {
  date: string;
  abs_profit: number;
  rel_profit: number;
  trade_count: number;
  starting_balance?: number;
  fiat_value?: number;
};

// ─── Data fetcher ─────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type HookOptions = {
  apiBase?: string;
  enabled?: boolean;
};

// ─── Hook: list all configured bots ──────────────────────────────────────────

export function useBotList(options?: HookOptions) {
  const apiBase = options?.apiBase ?? "/api/bots";
  const enabled = options?.enabled ?? true;
  const [bots, setBots] = useState<FtBotEntry[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setBots([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    apiFetch<FtBotEntry[]>(apiBase)
      .then(setBots)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [apiBase, enabled]);

  return { bots, loading, error };
}

// ─── Hook: bot stats (profit + balance + config) ──────────────────────────────

export function useBotStats(botId: string | null, options?: HookOptions) {
  const apiBase = options?.apiBase ?? "/api/bots";
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<FtStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(() => {
    if (!enabled || !botId) return;
    setLoading(true);
    setError(null);
    apiFetch<FtStats>(`${apiBase}/${botId}/stats`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [apiBase, botId, enabled]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { data, loading, error, refetch: fetch_ };
}

// ─── Hook: open trades ────────────────────────────────────────────────────────

export function useBotStatus(botId: string | null, options?: HookOptions) {
  const apiBase = options?.apiBase ?? "/api/bots";
  const enabled = options?.enabled ?? true;
  const [trades, setTrades] = useState<FtOpenTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetch_ = useCallback(() => {
    if (!enabled || !botId) return;
    setLoading(true);
    apiFetch<FtOpenTrade[]>(`${apiBase}/${botId}/status`)
      .then(setTrades)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [apiBase, botId, enabled]);

  useEffect(() => {
    if (!enabled) {
      setTrades([]);
      setLoading(false);
      setError(null);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    fetch_();
    // Auto-refresh open trades every 30 s
    timerRef.current = setInterval(fetch_, 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetch_]);

  return { trades, loading, error, refetch: fetch_ };
}

// ─── Hook: closed trades ──────────────────────────────────────────────────────

export function useBotTrades(botId: string | null, limit = 50, options?: HookOptions) {
  const apiBase = options?.apiBase ?? "/api/bots";
  const enabled = options?.enabled ?? true;
  const [trades, setTrades] = useState<FtClosedTrade[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !botId) {
      setTrades([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    apiFetch<{ trades: FtClosedTrade[]; total_trades: number }>(
      `${apiBase}/${botId}/trades?limit=${limit}`
    )
      .then((d) => { setTrades(d.trades); setTotal(d.total_trades ?? 0); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [apiBase, botId, enabled, limit]);

  return { trades, total, loading, error };
}

// ─── Hook: per-pair performance ───────────────────────────────────────────────

export function useBotPerformance(botId: string | null, options?: HookOptions) {
  const apiBase = options?.apiBase ?? "/api/bots";
  const enabled = options?.enabled ?? true;
  const [rows, setRows] = useState<FtPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !botId) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    apiFetch<FtPerformance[]>(`${apiBase}/${botId}/performance`)
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [apiBase, botId, enabled]);

  return { rows, loading, error };
}

// ─── Hook: daily performance rows ────────────────────────────────────────────

export function useBotDaily(botId: string | null, options?: HookOptions) {
  const apiBase = options?.apiBase ?? "/api/bots";
  const enabled = options?.enabled ?? true;
  const [rows, setRows] = useState<FtDailyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !botId) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    apiFetch<{ data: FtDailyRow[] }>(`${apiBase}/${botId}/daily`)
      .then((d) => setRows(d.data ?? []))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [apiBase, botId, enabled]);

  return { rows, loading, error };
}
