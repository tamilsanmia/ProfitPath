"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useCurrencyRealtime } from "@/hooks/use-currency-realtime"
import { formatCurrencyFromUsd, getPreferredCurrency } from "@/lib/currency-runtime"
import { cn } from "@/lib/utils"
import {
  Archive,
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Filter,
  LayoutGrid,
  LineChart,
  List,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Share2,
  SlidersHorizontal,
  Trash2,
  MoreHorizontal,
  XCircle,
  Wallet,
} from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  useBotList,
  useBotStats,
  useBotStatus,
  useBotTrades,
  useBotPerformance,
  useBotDaily,
} from "@/hooks/use-bot-data"
import type { FtOpenTrade, FtClosedTrade, FtPerformance, FtBotEntry, FtStats } from "@/hooks/use-bot-data"

// ─── helpers ──────────────────────────────────────────────────────────────────

function toSafeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function fmt(n: unknown, decimals = 2) {
  const safe = toSafeNumber(n)
  return safe.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function fmtPct(n: unknown) { return (toSafeNumber(n) * 100).toFixed(2) + "%" }
function fmtUsd(n: unknown) { return formatCurrencyFromUsd(toSafeNumber(n)) }

function fmtBotDisplayId(id?: string) {
  return String(id || "-")
}

function normalizeExchangeName(value?: string) {
  const raw = String(value || "").trim().toLowerCase()
  if (raw.includes("bybit")) return "Bybit"
  if (raw.includes("binance")) return "Binance"
  return "Exchange"
}

function exchangeFaviconUrl(value?: string) {
  const raw = String(value || "").trim().toLowerCase()
  if (raw.includes("bybit")) return "https://www.bybit.com/favicon.ico"
  return "https://bin.bnbstatic.com/static/images/common/favicon.ico"
}

function inferTradeTypeLabel(botName?: string, stakeAmount?: unknown) {
  const name = String(botName || "").toLowerCase()
  if (name.includes("fixed")) return "Fixed"
  if (name.includes("compound")) return "Compound"
  if (typeof stakeAmount === "string" && stakeAmount.trim().toLowerCase() === "unlimited") return "Compound"
  return "Fixed"
}

function fmtPair(pair?: string) {
  if (!pair) return "-"
  const main = pair.split(":")[0]
  return main.replace(/\//g, "")
}

function fmtShortAge(dateString?: string) {
  if (!dateString) return ""
  const dt = new Date(dateString)
  if (Number.isNaN(dt.getTime())) return ""

  const diffMs = Date.now() - dt.getTime()
  const diffMin = Math.max(0, Math.floor(diffMs / 60_000))

  const days = Math.floor(diffMin / 1_440)
  const hours = Math.floor((diffMin % 1_440) / 60)
  const minutes = diffMin % 60
  const parts: string[] = []

  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)

  return `${parts.join(" ")} ago`
}

function fmtDateTime(dateString?: string) {
  if (!dateString) return "-"
  const dt = new Date(dateString)
  if (Number.isNaN(dt.getTime())) return dateString
  const year = dt.getFullYear()
  const month = String(dt.getMonth() + 1).padStart(2, "0")
  const day = String(dt.getDate()).padStart(2, "0")
  const hours = String(dt.getHours()).padStart(2, "0")
  const minutes = String(dt.getMinutes()).padStart(2, "0")
  const seconds = String(dt.getSeconds()).padStart(2, "0")
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function fmtUtcDateTime(dateValue?: string | number) {
  if (dateValue === undefined || dateValue === null || dateValue === "") return "-"
  const dt = new Date(dateValue)
  if (Number.isNaN(dt.getTime())) return String(dateValue)
  const year = dt.getUTCFullYear()
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const day = String(dt.getUTCDate()).padStart(2, "0")
  const hours = String(dt.getUTCHours()).padStart(2, "0")
  const minutes = String(dt.getUTCMinutes()).padStart(2, "0")
  const seconds = String(dt.getUTCSeconds()).padStart(2, "0")
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function getCloseReason(trade: FtOpenTrade | FtClosedTrade | FtTradeDetail) {
  const t = trade as FtClosedTrade & FtTradeDetail
  return t.sell_reason ?? t.exit_reason ?? t.close_reason ?? "-"
}

function fmtDurationBetween(start?: string, end?: string) {
  if (!start || !end) return "-"
  const startDt = new Date(start)
  const endDt = new Date(end)
  if (Number.isNaN(startDt.getTime()) || Number.isNaN(endDt.getTime())) return "-"

  const diffMin = Math.max(0, Math.floor((endDt.getTime() - startDt.getTime()) / 60_000))
  const days = Math.floor(diffMin / 1_440)
  const hours = Math.floor((diffMin % 1_440) / 60)
  const minutes = diffMin % 60
  const parts: string[] = []

  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)

  return parts.join(" ")
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

const selectClassName =
  "h-8 appearance-none rounded-full border border-border bg-background px-3 pr-7 text-xs text-foreground outline-none cursor-pointer"

const FILTER_ALL = "All"

// ─── small sub-components ─────────────────────────────────────────────────────

function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
}

function OrderDetailsSkeleton() {
  return (
    <div className="space-y-4 pb-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
          <div className="h-6 w-28 animate-pulse rounded bg-muted/40" />
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={`general-${index}`} className="flex items-center justify-between gap-4">
              <div className="h-4 w-24 animate-pulse rounded bg-muted/30" />
              <div className="h-4 w-28 animate-pulse rounded bg-muted/40" />
            </div>
          ))}
        </div>

        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, blockIndex) => (
            <div key={`detail-block-${blockIndex}`} className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
              <div className="h-6 w-24 animate-pulse rounded bg-muted/40" />
              {Array.from({ length: 4 }).map((__, rowIndex) => (
                <div key={`detail-row-${blockIndex}-${rowIndex}`} className="flex items-center justify-between gap-4">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted/30" />
                  <div className="h-4 w-24 animate-pulse rounded bg-muted/40" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-black/40 p-3">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="h-6 w-24 animate-pulse rounded bg-muted/40" />
          <div className="h-4 w-28 animate-pulse rounded bg-muted/30" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={`order-${index}`} className="h-5 w-full animate-pulse rounded bg-muted/30" />
        ))}
      </div>
    </div>
  )
}

type OpenTradeAction = "forceexit_limit" | "forceexit_market" | "forceexit_partial" | "reload" | "delete_trade"

type FtTradeDetailOrder = {
  order_id?: number
  order_date?: string
  order_date_utc?: string
  order_timestamp?: number
  order_filled_timestamp?: number
  side?: string
  ft_order_side?: string
  rate?: number
  price?: number
  safe_price?: number
  amount?: number
  filled?: number
  reason?: string
  order_tag?: string
  ft_order_tag?: string
}

type FtTradeDetail = Partial<FtOpenTrade & FtClosedTrade> & {
  entry_tag?: string
  enter_tag?: string
  min_rate?: number
  max_rate?: number
  fee_open_cost?: number
  fee_open?: number
  fee_close_cost?: number
  fee_close?: number
  stop_loss_pct?: number
  stop_loss_abs?: number
  stoploss_current_dist_pct?: number
  stoploss_current_dist?: number
  initial_stop_loss_pct?: number
  initial_stop_loss_abs?: number
  amount_requested?: number
  funding_fees?: number
  interest_rate?: number
  liquidation_price?: number
  is_short?: boolean
  leverage?: number
  open_date_utc?: string
  close_date_utc?: string
  close_profit_abs?: number
  close_profit_pct?: number
  orders?: FtTradeDetailOrder[]
}

function fmtPctNumber(value?: number, decimals = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  const pct = Math.abs(value) <= 1 ? value * 100 : value
  return `${pct.toFixed(decimals)}%`
}

function TradeRow({
  t,
  open,
  onOpenAction,
  actionLoadingId,
  onSelectTrade,
  showActions = true,
}: {
  t: FtOpenTrade | FtClosedTrade
  open: boolean
  onOpenAction?: (trade: FtOpenTrade, action: OpenTradeAction) => void
  actionLoadingId?: number | null
  onSelectTrade?: (trade: FtOpenTrade | FtClosedTrade, isOpen: boolean) => void
  showActions?: boolean
}) {
  const rawProfitPct = "profit_pct" in t ? t.profit_pct : 0
  const normalizedRawPct = Math.abs(rawProfitPct) <= 1 ? rawProfitPct * 100 : rawProfitPct
  const computedPct =
    typeof t.stake_amount === "number" && Number.isFinite(t.stake_amount) && t.stake_amount !== 0
      ? (t.profit_abs / t.stake_amount) * 100
      : null
  const profitPct = computedPct ?? normalizedRawPct
  const pnlClass = t.profit_abs >= 0 ? "text-emerald-400" : "text-red-400"
  const isDca = (t.nr_of_successful_entries ?? 1) > 1
  const orderDuration = open && "trade_duration" in t
    ? (t.trade_duration || fmtDurationBetween(t.open_date, new Date().toISOString()))
    : ("close_date" in t ? fmtDurationBetween(t.open_date, t.close_date) : "-")

  if (open && "current_rate" in t) {
    return (
      <tr
        className="cursor-pointer border-b border-border text-xs transition-colors hover:bg-muted/20 last:border-0"
        onClick={() => onSelectTrade?.(t, true)}
      >
        <td className="min-w-[150px] whitespace-nowrap py-2 pr-4 font-medium text-foreground">
          #{t.trade_id} | <span className={cn(t.is_short ? "text-red-400" : "text-emerald-400")}>{t.is_short ? "Short" : "Long"}</span>
        </td>
        <td className="py-2 pr-4 font-medium text-foreground">{fmtPair(t.pair)}{isDca && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">DCA</span>}</td>
        <td className="py-2 pr-4 text-muted-foreground">
          {t.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 })}
        </td>
        <td className="py-2 pr-4 text-muted-foreground">
          {fmtUsd(t.stake_amount)}
          {typeof t.leverage === "number" && Number.isFinite(t.leverage) ? ` (${fmt(t.leverage, 0)}x)` : ""}
        </td>
        <td className="py-2 pr-4 text-muted-foreground">
          {t.open_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
        </td>
        <td className="py-2 pr-4 text-muted-foreground">
          {t.current_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
        </td>
        <td className={cn("min-w-[150px] whitespace-nowrap py-2 pr-4", pnlClass)}>
          {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}% ({fmtUsd(t.profit_abs)})
        </td>
        <td className="py-2 pr-4 text-muted-foreground">
          <span>{fmtDateTime(t.open_date)}</span>
          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">{fmtShortAge(t.open_date)}</span>
        </td>
        <td className="py-2 pr-4">
          <span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{orderDuration || "-"}</span>
        </td>
        {showActions && <td className="py-2 pr-1 align-middle text-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mx-auto flex h-6 w-6 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground opacity-70 transition hover:opacity-100 hover:text-foreground focus-visible:outline-none"
                disabled={actionLoadingId === t.trade_id}
                onClick={(event) => event.stopPropagation()}
              >
                {actionLoadingId === t.trade_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => onOpenAction?.(t, "forceexit_limit")}>
                <XCircle className="mr-2 h-3.5 w-3.5" />
                Forceexit limit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenAction?.(t, "forceexit_market")}>
                <XCircle className="mr-2 h-3.5 w-3.5" />
                Forceexit market
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onOpenAction?.(t, "forceexit_partial")}>
                <XCircle className="mr-2 h-3.5 w-3.5" />
                Forceexit partial
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Close Actions menu</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>}
      </tr>
    )
  }

  return (
    <tr
      className="cursor-pointer border-b border-border text-xs transition-colors hover:bg-muted/20 last:border-0"
      onClick={() => onSelectTrade?.(t, false)}
    >
      <td className="min-w-[150px] whitespace-nowrap py-2 pr-4 font-medium text-foreground">
        #{t.trade_id}
        {typeof t.is_short === "boolean" && (
          <>
            {" | "}
            <span className={cn(t.is_short ? "text-red-400" : "text-emerald-400")}>{t.is_short ? "Short" : "Long"}</span>
          </>
        )}
      </td>
      <td className="py-2 pr-4 font-medium text-foreground">{fmtPair(t.pair)}{isDca && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">DCA</span>}</td>
      <td className="py-2 pr-4 text-muted-foreground">
        {typeof t.amount === "number" ? t.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 }) : "-"}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">
        {"stake_amount" in t ? fmtUsd(t.stake_amount) : "-"}
        {typeof t.leverage === "number" && Number.isFinite(t.leverage) ? ` (${fmt(t.leverage, 0)}x)` : ""}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">
        {"open_rate" in t ? t.open_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">
        {"close_rate" in t ? t.close_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}
      </td>
      <td className={cn("min-w-[150px] whitespace-nowrap py-2 pr-4", pnlClass)}>
        {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}% ({fmtUsd(t.profit_abs)})
      </td>
      <td className="py-2 pr-4 text-muted-foreground">{fmtDateTime(t.open_date)}</td>
      <td className="py-2 pr-4 text-muted-foreground">{"close_date" in t ? fmtDateTime(t.close_date) : "-"}</td>
      <td className="py-2 pr-4">
        <span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{orderDuration || "-"}</span>
      </td>
      {!open && (
        <td className="py-2 text-muted-foreground">{getCloseReason(t)}</td>
      )}
    </tr>
  )
}

function PerfRow({ row }: { row: FtPerformance }) {
  const profitPct = typeof row.profit_pct === "number"
    ? row.profit_pct
    : Math.abs(row.profit_ratio) <= 1
    ? row.profit_ratio * 100
    : row.profit_ratio
  const pos = profitPct >= 0
  const profitAbs = typeof row.profit_abs === "number" ? row.profit_abs : row.profit
  return (
    <tr className="border-b border-border text-xs last:border-0">
      <td className="py-2 pr-4 font-medium text-foreground">{fmtPair(row.pair)}</td>
      <td className={cn("py-2 pr-4", pos ? "text-emerald-400" : "text-red-400")}>
        {pos ? "+" : ""}{profitPct.toFixed(2)}%
      </td>
      <td className={cn("py-2 pr-4", profitAbs >= 0 ? "text-emerald-400" : "text-red-400")}>
        {profitAbs >= 0 ? "+" : ""}{fmtUsd(profitAbs)}
      </td>
      <td className="py-2 text-muted-foreground">{row.count}</td>
    </tr>
  )
}

function BotSummaryCard({
  bot,
  isSelected,
  viewMode,
  onSelect,
  archived,
  onToggleArchived,
  statsOverride,
}: {
  bot: FtBotEntry
  isSelected: boolean
  viewMode: "cards" | "list"
  onSelect: () => void
  archived: boolean
  onToggleArchived: (botId: string) => void
  statsOverride?: FtStats | null
}) {
  const { data: stats, loading } = useBotStats(bot.id)
  const resolvedStats = statsOverride ?? stats
  const resolvedLoading = statsOverride ? false : loading
  const showPreloader = resolvedLoading && !resolvedStats

  const status = resolvedStats?.config?.state ?? (resolvedLoading ? "Loading" : "Unknown")
  const setupCompleted = status.toLowerCase() !== "pending_setup"
  const statusLabel = setupCompleted ? (archived ? "Archived" : "Running") : "New"
  const statusClassName = setupCompleted
    ? archived
      ? "rounded-full border border-slate-500/40 bg-slate-500/15 px-2.5 py-0.5 text-[11px] font-medium text-slate-200"
      : "rounded-full border border-emerald-400/20 bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300"
    : "rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan-200"
  const capital = Number(resolvedStats?.balance_usdt ?? 0)
  const pnlClosed = Number(resolvedStats?.profit?.profit_closed_fiat ?? 0)
  const openProfit = Number(resolvedStats?.profit?.profit_all_coin ?? 0) - Number(resolvedStats?.profit?.profit_closed_coin ?? 0)
  const rawProfitPercent = Number(resolvedStats?.profit?.profit_closed_percent ?? 0)
  const profitPercent = Math.abs(rawProfitPercent) <= 1 ? rawProfitPercent * 100 : rawProfitPercent
  const exchangeName = normalizeExchangeName(String(resolvedStats?.config?.exchange || bot.name))
  const tradeType = inferTradeTypeLabel(bot.name, resolvedStats?.config?.stake_amount)
  const favicon = exchangeFaviconUrl(exchangeName)
  const isDemo = (bot.account_type || "").toLowerCase().includes("demo")
  const isReal = (bot.account_type || "").toLowerCase().includes("real")

  if (viewMode === "list") {
    return (
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "w-full rounded-lg border bg-card px-4 py-4 text-left transition-all hover:border-primary/60",
          isSelected ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]" : "border-border",
          archived && "opacity-80",
        )}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onSelect()
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <img src={favicon} alt={exchangeName} className="h-[18px] w-[18px] rounded-sm" />
              <p className="text-[16px] font-semibold text-white">{fmtBotDisplayId(bot.id)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isDemo && (
              <Badge className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">Demo</Badge>
            )}
            {!isDemo && isReal && (
              <Badge className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">Real</Badge>
            )}
            <Badge className={statusClassName}>{statusLabel}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/60 p-0 text-muted-foreground hover:text-foreground"
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onToggleArchived(bot.id)
                  }}
                >
                  {archived ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="pt-[5px] text-[12px] font-medium text-[#99a1af]">
          {showPreloader ? (
            <div className="h-4 w-44 animate-pulse rounded bg-muted/40" />
          ) : (
            <>
              <span>{fmtUsd(Math.max(0, capital))}</span>
              <span className="mx-2">•</span>
              <span>{exchangeName}</span>
              <span className="mx-2">•</span>
              <span>{tradeType}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <Card
      className={cn(
        "cursor-pointer rounded-lg border bg-card transition-all hover:border-primary/60",
        isSelected ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]" : "border-border",
        archived && "opacity-80",
      )}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <img src={favicon} alt={exchangeName} className="h-[18px] w-[18px] rounded-sm" />
              <p className="text-[16px] font-semibold text-white">{fmtBotDisplayId(bot.id)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isDemo && (
              <Badge className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">Demo</Badge>
            )}
            {!isDemo && isReal && (
              <Badge className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">Real</Badge>
            )}
            <Badge className={statusClassName}>{statusLabel}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/60 p-0 text-muted-foreground hover:text-foreground"
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onToggleArchived(bot.id)
                  }}
                >
                  {archived ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="text-[12px] font-medium text-[#99a1af]">
          {showPreloader ? (
            <div className="h-4 w-52 animate-pulse rounded bg-muted/40" />
          ) : (
            <>
              <span>{fmtUsd(Math.max(0, capital))}</span>
              <span className="mx-2">•</span>
              <span>{exchangeName}</span>
              <span className="mx-2">•</span>
              <span>{tradeType}</span>
            </>
          )}
        </div>

        {showPreloader ? (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-background/40">
            {[0, 1, 2, 3].map((item) => (
              <div key={item}>
                <div className="h-3 w-14 animate-pulse rounded bg-muted/40" />
                <div className="mt-2 h-4 w-20 animate-pulse rounded bg-muted/50" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-background/40">
            <div>
              <p className="pt-[5px] text-[11px] text-[#99a1af]">Balance</p>
              <p className="text-[12px] font-semibold text-foreground">{fmtUsd(capital)}</p>
            </div>
            <div>
              <p className="pt-[5px] text-[11px] text-[#99a1af]">P&amp;L</p>
              <p className={cn("text-[12px] font-semibold", pnlClosed >= 0 ? "text-emerald-400" : "text-red-400")}>
                {pnlClosed >= 0 ? "+" : ""}
                {fmtUsd(pnlClosed)}
              </p>
            </div>
            <div>
              <p className="pt-[5px] text-[11px] text-[#99a1af]">Profit %</p>
              <p className={cn("text-[12px] font-semibold", profitPercent >= 0 ? "text-emerald-400" : "text-red-400")}>
                {profitPercent >= 0 ? "+" : ""}
                {profitPercent.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="pt-[5px] text-[11px] text-[#99a1af]">Open Profit</p>
              <p className={cn("text-[12px] font-semibold", openProfit >= 0 ? "text-emerald-400" : "text-red-400")}>
                {openProfit >= 0 ? "+" : ""}
                {fmtUsd(openProfit)}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── main export ──────────────────────────────────────────────────────────────

export function MyBotsPage({ initialBotId = null, publicView = false }: { initialBotId?: string | null; publicView?: boolean } = {}) {
  useCurrencyRealtime()
  const displayCurrency = getPreferredCurrency()

  const searchParams = useSearchParams()
  const paymentDone = searchParams.get("payment") === "done"
  const purchasedBotId = searchParams.get("bot")

  const [selectedId, setSelectedId] = useState<string | null>(initialBotId)
  const [showPaymentBanner, setShowPaymentBanner] = useState(paymentDone)
  const [setupLoading, setSetupLoading] = useState(false)
  const [setupValidateLoading, setSetupValidateLoading] = useState(false)
  const [setupDeployLoading, setSetupDeployLoading] = useState(false)
  const [setupMessage, setSetupMessage] = useState<string | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [copiedIpField, setCopiedIpField] = useState<"created" | "backend" | null>(null)
  const [pipelineStep, setPipelineStep] = useState<1 | 2 | 3>(1)
  const [binanceApiKey, setBinanceApiKey] = useState("")
  const [binanceApiSecret, setBinanceApiSecret] = useState("")
  const [setupState, setSetupState] = useState<{
    status?: string
    last_step?: string
    server_ip?: string
    backend_server_ip?: string
    deploy_enabled?: boolean
    deploy_unavailable_reason?: string
    last_error?: string
    strategy_settings?: {
      strategy_name?: string
      trade_type?: string
      dca_mode?: string
      dca_enabled?: boolean
      stake_amount?: number
      max_open_order?: number
      stoploss_pct?: number
      dca_stoploss_pct?: number
      entry_30m_enabled?: boolean
      entry_1h_enabled?: boolean
      entry_4h_enabled?: boolean
      use_chg_filter?: boolean
      chg_30m_enabled?: boolean
      chg_1h_enabled?: boolean
      chg_4h_enabled?: boolean
      chg_30m_min?: number
      chg_30m_max?: number
      chg_1h_min?: number
      chg_1h_max?: number
      chg_4h_min?: number
      chg_4h_max?: number
      dca_chg_30m_min?: number
      dca_chg_30m_max?: number
      dca_chg_1h_min?: number
      dca_chg_1h_max?: number
      dca_chg_4h_min?: number
      dca_chg_4h_max?: number
      chg_30m_exit_buffer?: number
      chg_1h_exit_buffer?: number
      chg_4h_exit_buffer?: number
      dca_reentry_min_profit?: number
      dca_reentry_max_drawdown?: number
      leverage?: number
    }
    history?: Array<{ step?: string; status?: string; message?: string; timestamp?: string }>
  } | null>(null)
  const [typeFilter, setTypeFilter] = useState(FILTER_ALL)
  const [exchangeFilter, setExchangeFilter] = useState(FILTER_ALL)
  const [stateFilter, setStateFilter] = useState(FILTER_ALL)
  const [archiveDisplayFilter, setArchiveDisplayFilter] = useState(FILTER_ALL)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards")
  const [historyTab, setHistoryTab] = useState<"open" | "closed" | "performance">("open")
  const [chartRange, setChartRange] = useState<"7D" | "1M" | "3M" | "All">("All")
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null)
  const [forceExitAllLoading, setForceExitAllLoading] = useState(false)
  const [botControlLoading, setBotControlLoading] = useState<"pause" | "start" | null>(null)
  const [exchangePanelOpen, setExchangePanelOpen] = useState(false)
  const [exchangeAccountName, setExchangeAccountName] = useState("")
  const [exchangeApiKeyInput, setExchangeApiKeyInput] = useState("")
  const [exchangeApiSecretInput, setExchangeApiSecretInput] = useState("")
  const [exchangeIpsCopied, setExchangeIpsCopied] = useState(false)
  const [exchangeConnectLoading, setExchangeConnectLoading] = useState(false)
  const [exchangeConnectStage, setExchangeConnectStage] = useState<"validating" | "switching" | null>(null)
  const [switchToDryRunDialogOpen, setSwitchToDryRunDialogOpen] = useState(false)
  const [switchToDryRunLoading, setSwitchToDryRunLoading] = useState(false)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    tradeType: "compound" as "fixed" | "compound",
    dcaMode: "Enable" as "Enable" | "Disable",
    stakeAmount: 50,
    maxOpenOrder: 15,
    stoplossPct: 99,
    dcaStoplossPct: 50,
    entry30mEnabled: false,
    entry1hEnabled: false,
    entry4hEnabled: false,
    useChgFilter: true,
    chg30mEnabled: true,
    chg1hEnabled: true,
    chg4hEnabled: true,
    chg30mMin: -10,
    chg30mMax: 10,
    chg1hMin: -10,
    chg1hMax: 10,
    chg4hMin: -10,
    chg4hMax: 10,
    dcaChg30mMin: -10,
    dcaChg30mMax: 10,
    dcaChg1hMin: -10,
    dcaChg1hMax: 10,
    dcaChg4hMin: -10,
    dcaChg4hMax: 10,
    chg30mExitBuffer: 2,
    chg1hExitBuffer: 2,
    chg4hExitBuffer: 2,
    dcaReentryMinProfit: -5,
    dcaReentryMaxDrawdown: -30,
    leverage: 5,
  })
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [archivedBots, setArchivedBots] = useState<Record<string, boolean>>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [shareStateByBot, setShareStateByBot] = useState<Record<string, { enabled: boolean; token: string }>>({})
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [activeTrade, setActiveTrade] = useState<{ trade: FtOpenTrade | FtClosedTrade; isOpen: boolean } | null>(null)
  const [activeTradeDetail, setActiveTradeDetail] = useState<FtTradeDetail | null>(null)
  const [activeTradeDetailLoading, setActiveTradeDetailLoading] = useState(false)
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const setupBotId = publicView ? null : selectedId

  const refreshSetupState = useCallback(async () => {
    if (!setupBotId) {
      setSetupState(null)
      return
    }

    try {
      const res = await fetch(`/api/subscription/bots/${encodeURIComponent(setupBotId)}/setup`, { cache: "no-store" })
      const payload = (await res.json().catch(() => ({}))) as {
        setup?: {
          status?: string
          last_step?: string
          server_ip?: string
          backend_server_ip?: string
          deploy_enabled?: boolean
          deploy_unavailable_reason?: string
          last_error?: string
          strategy_settings?: {
            strategy_name?: string
            trade_type?: string
            dca_mode?: string
            dca_enabled?: boolean
            stake_amount?: number
            max_open_order?: number
            stoploss_pct?: number
            dca_stoploss_pct?: number
            entry_30m_enabled?: boolean
            entry_1h_enabled?: boolean
            entry_4h_enabled?: boolean
            use_chg_filter?: boolean
            chg_30m_enabled?: boolean
            chg_1h_enabled?: boolean
            chg_4h_enabled?: boolean
            chg_30m_min?: number
            chg_30m_max?: number
            chg_1h_min?: number
            chg_1h_max?: number
            chg_4h_min?: number
            chg_4h_max?: number
            dca_chg_30m_min?: number
            dca_chg_30m_max?: number
            dca_chg_1h_min?: number
            dca_chg_1h_max?: number
            dca_chg_4h_min?: number
            dca_chg_4h_max?: number
            chg_30m_exit_buffer?: number
            chg_1h_exit_buffer?: number
            chg_4h_exit_buffer?: number
            dca_reentry_min_profit?: number
            dca_reentry_max_drawdown?: number
            leverage?: number
          }
          history?: Array<{ step?: string; status?: string; message?: string; timestamp?: string }>
        }
      }

      if (!res.ok) {
        setSetupState(null)
        return
      }

      const setup = payload.setup ?? null
      setSetupState(setup)
      if (!setup) return

      if (setup.status === "completed") {
        setPipelineStep(3)
      } else if ((setup.history ?? []).some((item) => String(item?.status || "") === "api_validated")) {
        setPipelineStep(3)
      } else if (setup.server_ip) {
        setPipelineStep(2)
      } else {
        setPipelineStep(1)
      }

      if (setup.status === "completed") {
        setSetupMessage(`Setup already completed | Server IP: ${setup.server_ip || "-"}`)
        setSetupError(null)
      } else if (setup.last_error) {
        setSetupError(setup.last_error)
      } else if (setup.last_step) {
        setSetupMessage(`Current step: ${setup.last_step.replace(/_/g, " ")} (${setup.status || "pending"})`)
      }
    } catch {
      setSetupState(null)
    }
  }, [setupBotId])

  const apiBase = publicView ? "/api/shared/bot-accounts" : "/api/bots"

  // Real data hooks
  const { bots, loading: botsLoading } = useBotList({ enabled: !publicView })
  const { data: stats, loading: statsLoading, error: statsError, refetch: refetchStats } = useBotStats(selectedId, { apiBase })
  const { trades: openTrades, loading: openLoading, refetch: refetchOpen } = useBotStatus(selectedId, { apiBase })
  const { trades: closedTrades, total: totalTrades, loading: closedLoading } = useBotTrades(selectedId, 500, { apiBase })
  const { rows: perfRows, loading: perfLoading } = useBotPerformance(selectedId, { apiBase })
  const { rows: dailyRows } = useBotDaily(selectedId, { apiBase })

  useEffect(() => {
    if (initialBotId) setSelectedId(initialBotId)
  }, [initialBotId])

  useEffect(() => {
    setShowPaymentBanner(paymentDone)
  }, [paymentDone])

  useEffect(() => {
    if (!showPaymentBanner) return

    const timer = window.setTimeout(() => {
      setShowPaymentBanner(false)
    }, 10000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [showPaymentBanner])

  useEffect(() => {
    if (publicView) return
    if (!purchasedBotId) return
    if (bots.some((b) => b.id === purchasedBotId)) {
      setSelectedId(purchasedBotId)
    }
  }, [bots, publicView, purchasedBotId])

  useEffect(() => {
    if (publicView) return
    try {
      const raw = window.localStorage.getItem("pp_archived_bots")
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, boolean>
      if (parsed && typeof parsed === "object") {
        setArchivedBots(parsed)
      }
    } catch {
      // no-op: invalid local storage payload
    }
  }, [publicView])

  useEffect(() => {
    if (publicView) return
    try {
      window.localStorage.setItem("pp_archived_bots", JSON.stringify(archivedBots))
    } catch {
      // no-op: storage unavailable
    }
  }, [archivedBots, publicView])

  const toggleArchived = (botId: string) => {
    setArchivedBots((prev) => ({
      ...prev,
      [botId]: !prev[botId],
    }))
  }

  useEffect(() => {
    void refreshSetupState()
  }, [refreshSetupState])

  const publicBot = useMemo(() => {
    if (!selectedId) return null
    return {
      id: selectedId,
      name: stats?.bot_name ?? selectedId,
    }
  }, [selectedId, stats?.bot_name])

  const filteredBots = useMemo(() => {
    if (publicView) return publicBot ? [publicBot] : []
    let result = bots
    if (typeFilter !== FILTER_ALL) {
      result = result.filter((b) => {
        const at = (b.account_type || "").toLowerCase()
        const isDemo = at === "demo" || at.includes("demo")
        return typeFilter === "Demo" ? isDemo : !isDemo
      })
    }
    if (exchangeFilter !== FILTER_ALL) {
      result = result.filter((b) =>
        b.name.toLowerCase().includes(exchangeFilter.toLowerCase())
      )
    }
    if (archiveDisplayFilter !== FILTER_ALL) {
      result = result.filter((b) => {
        const isArch = !!archivedBots[b.id]
        return archiveDisplayFilter === "Archived" ? isArch : !isArch
      })
    }
    return result
  }, [bots, publicBot, publicView, typeFilter, exchangeFilter, archiveDisplayFilter, archivedBots])

  const backendServerIpDisplay = useMemo(() => {
    const direct = String(setupState?.backend_server_ip || "").trim()
    if (direct) return direct

    const fallbackSource = [setupError, setupState?.last_error].filter(Boolean).join(" ")
    const match = fallbackSource.match(/request\s+ip\s*:\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})/i)
    return match?.[1] || "167.71.232.153"
  }, [setupError, setupState?.backend_server_ip, setupState?.last_error])

  const setupHistory = setupState?.history ?? []
  const selectedStrategyName = String(setupState?.strategy_settings?.strategy_name || "ProfitPath")
    .replace(/[^A-Za-z0-9_]/g, "")
    || "ProfitPath"
  const bot = publicView ? publicBot : bots.find((b) => b.id === selectedId) ?? null
  const displayBotId = bot?.id || selectedId || "-"

  const botExchange = normalizeExchangeName((bot as { name?: string } | null)?.name)
  const botAccountType = String((bot as { account_type?: string } | null)?.account_type || "").toLowerCase()
  const isBotLiveMode = stats ? !Boolean(stats.config?.dry_run) : botAccountType.includes("real")
  const botIsDemo = String((bot as { account_type?: string } | null)?.account_type || "").toLowerCase().includes("demo")
  const showApiStep = !botIsDemo

  const isApiValidated = setupHistory.some((item) => String(item?.status || "") === "api_validated")
  const isDeployCompleted =
    String(setupState?.status || "").toLowerCase() === "completed" ||
    setupHistory.some((item) => String(item?.status || "") === "deploy_completed")
  const isServerCreated = Boolean(setupState?.server_ip)
  const isApiStepCompleted = !showApiStep || isApiValidated || String(setupState?.status || "").toLowerCase() === "completed"
  const deployStepAvailable = setupState?.deploy_enabled !== false
  const setupInstallerLoading = setupLoading || setupValidateLoading || setupDeployLoading
  const setupInstallerLoadingText = setupLoading
    ? "Creating server..."
    : setupValidateLoading
    ? "Validating API..."
    : setupDeployLoading
    ? "Deploying bot..."
    : null

  useEffect(() => {
    if (!setupBotId) return
    const status = String(setupState?.status || "").toLowerCase()
    if (!setupInstallerLoading && (status === "completed" || status === "failed")) return

    const timer = window.setInterval(() => {
      void refreshSetupState()
    }, 5000)

    return () => window.clearInterval(timer)
  }, [setupBotId, setupInstallerLoading, setupState?.status, refreshSetupState])
  const showCreatedServerIp = botExchange === "Binance" && !botIsDemo
  const exchangeWhitelistIps = useMemo(() => {
    const result: string[] = []
    const created = String(setupState?.server_ip || "").trim()
    if (created) result.push(created)
    result.push("167.71.232.153")
    return result.join(" ")
  }, [setupState?.server_ip])

  useEffect(() => {
    const runtime = setupState?.strategy_settings
    const config = stats?.config

    const tradeTypeRaw = String(runtime?.trade_type || "").toLowerCase()
    const tradeType = tradeTypeRaw.includes("fixed") ? "fixed" : "compound"

    const dcaMode = String(runtime?.dca_mode || "Enable").toLowerCase().includes("disable") ? "Disable" : "Enable"

    const configStake = typeof config?.stake_amount === "number"
      ? config.stake_amount
      : Number(config?.stake_amount)
    const fallbackStake = Number.isFinite(configStake) && configStake > 0 ? configStake : 50

    const stoplossPctRaw = Number(runtime?.stoploss_pct)
    const dcaStoplossPctRaw = Number(runtime?.dca_stoploss_pct)
    const maxOpenRaw = Number(runtime?.max_open_order ?? config?.max_open_trades ?? 15)
    const leverageRaw = Number(runtime?.leverage ?? 5)
    const dcaReentryMinRaw = Number(runtime?.dca_reentry_min_profit ?? -0.05)
    const dcaReentryMaxRaw = Number(runtime?.dca_reentry_max_drawdown ?? -0.3)

    setSettingsForm({
      tradeType,
      dcaMode,
      stakeAmount: Number(runtime?.stake_amount ?? fallbackStake),
      maxOpenOrder: Number.isFinite(maxOpenRaw) ? Math.max(1, Math.min(100, Math.trunc(maxOpenRaw))) : 15,
      stoplossPct: Number.isFinite(stoplossPctRaw) ? Math.max(1, Math.min(100, Math.abs(stoplossPctRaw))) : 99,
      dcaStoplossPct: Number.isFinite(dcaStoplossPctRaw) ? Math.max(1, Math.min(100, Math.abs(dcaStoplossPctRaw))) : 50,
      entry30mEnabled: runtime?.entry_30m_enabled ?? false,
      entry1hEnabled: runtime?.entry_1h_enabled ?? false,
      entry4hEnabled: runtime?.entry_4h_enabled ?? false,
      useChgFilter: runtime?.use_chg_filter ?? true,
      chg30mEnabled: runtime?.chg_30m_enabled ?? true,
      chg1hEnabled: runtime?.chg_1h_enabled ?? true,
      chg4hEnabled: runtime?.chg_4h_enabled ?? true,
      chg30mMin: Number(runtime?.chg_30m_min ?? -10),
      chg30mMax: Number(runtime?.chg_30m_max ?? 10),
      chg1hMin: Number(runtime?.chg_1h_min ?? -10),
      chg1hMax: Number(runtime?.chg_1h_max ?? 10),
      chg4hMin: Number(runtime?.chg_4h_min ?? -10),
      chg4hMax: Number(runtime?.chg_4h_max ?? 10),
      dcaChg30mMin: Number(runtime?.dca_chg_30m_min ?? -10),
      dcaChg30mMax: Number(runtime?.dca_chg_30m_max ?? 10),
      dcaChg1hMin: Number(runtime?.dca_chg_1h_min ?? -10),
      dcaChg1hMax: Number(runtime?.dca_chg_1h_max ?? 10),
      dcaChg4hMin: Number(runtime?.dca_chg_4h_min ?? -10),
      dcaChg4hMax: Number(runtime?.dca_chg_4h_max ?? 10),
      chg30mExitBuffer: Number(runtime?.chg_30m_exit_buffer ?? 2),
      chg1hExitBuffer: Number(runtime?.chg_1h_exit_buffer ?? 2),
      chg4hExitBuffer: Number(runtime?.chg_4h_exit_buffer ?? 2),
      dcaReentryMinProfit: Number.isFinite(dcaReentryMinRaw) ? (Math.abs(dcaReentryMinRaw) <= 1 ? dcaReentryMinRaw * 100 : dcaReentryMinRaw) : -5,
      dcaReentryMaxDrawdown: Number.isFinite(dcaReentryMaxRaw) ? (Math.abs(dcaReentryMaxRaw) <= 1 ? dcaReentryMaxRaw * 100 : dcaReentryMaxRaw) : -30,
      leverage: Number.isFinite(leverageRaw) ? Math.max(1, Math.min(125, leverageRaw)) : 5,
    })
  }, [setupState?.strategy_settings, stats?.config])

  const unrealizedPnl = useMemo(() => {
    return openTrades.reduce((sum, t) => sum + (t.profit_abs ?? 0), 0)
  }, [openTrades])

  // Derived display values from real stats
  const overviewCards = stats
    ? [
        {
          label: "Account Size",
          value: fmtUsd(stats.balance_usdt),
          valueClassName: stats.balance_usdt >= 0 ? "text-emerald-400" : "text-red-400",
        },
        {
          label: "PnL (Closed)",
          value: fmtUsd(stats.profit.profit_closed_fiat),
          valueClassName: stats.profit.profit_closed_fiat >= 0 ? "text-emerald-400" : "text-red-400",
        },
        {
          label: "Open Profit",
          value: fmtUsd(unrealizedPnl),
          valueClassName: unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400",
        },
        { label: "First Trade", value: stats.profit.first_trade_date?.slice(0, 10) ?? "—" },
        { label: "Latest Trade", value: stats.profit.latest_trade_date?.slice(0, 10) ?? "—" },
      ]
    : []

  const calendarYear = calendarCursor.getFullYear()
  const calendarMonth = calendarCursor.getMonth()
  const monthLabel = calendarCursor.toLocaleString("en-US", { month: "long", year: "numeric" })
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate()
  const firstWeekday = new Date(calendarYear, calendarMonth, 1).getDay()
  const monthOptions = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]

  const calendarYears = useMemo(() => {
    const nowYear = new Date().getFullYear()
    let minYear = nowYear - 5
    let maxYear = nowYear + 5

    for (const row of dailyRows) {
      const d = row.date ? new Date(row.date) : null
      if (!d || Number.isNaN(d.getTime())) continue
      const y = d.getFullYear()
      if (y < minYear) minYear = y
      if (y > maxYear) maxYear = y
    }

    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)
  }, [dailyRows])

  const dailyTradeMap = useMemo(() => {
    const map = new Map<number, { count: number; pnl: number }>()
    for (const row of dailyRows) {
      const d = row.date ? new Date(row.date) : null
      if (!d || Number.isNaN(d.getTime())) continue
      if (d.getFullYear() !== calendarYear || d.getMonth() !== calendarMonth) continue

      const day = d.getDate()
      const prev = map.get(day) ?? { count: 0, pnl: 0 }
      prev.count += row.trade_count ?? 0
      prev.pnl += row.abs_profit ?? 0
      map.set(day, prev)
    }
    return map
  }, [dailyRows, calendarMonth, calendarYear])

  const monthDays = useMemo(() => {
    return Array.from({ length: 42 }, (_, index) => {
      const dayNum = index - firstWeekday + 1
      return dayNum > 0 && dayNum <= daysInMonth ? dayNum : null
    })
  }, [daysInMonth, firstWeekday])

  const weeklySummary = useMemo(() => {
    const labels = ["Week One", "Week Two", "Week Three", "Week Four", "Week Five", "Week Six"]
    const weeks: Array<{ week: string; range: string; count: number; pnl: number }> = []

    for (let i = 0; i < 6; i += 1) {
      const start = i * 7 + 1
      if (start > daysInMonth) break
      const end = Math.min(daysInMonth, start + 6)

      let count = 0
      let pnl = 0
      for (let day = start; day <= end; day += 1) {
        const entry = dailyTradeMap.get(day)
        if (!entry) continue
        count += entry.count
        pnl += entry.pnl
      }

      weeks.push({
        week: labels[i],
        range: `${new Date(calendarYear, calendarMonth, start).toLocaleString("en-US", { month: "short" })} ${start} - ${new Date(calendarYear, calendarMonth, end).toLocaleString("en-US", { month: "short" })} ${end}`,
        count,
        pnl,
      })
    }

    return weeks
  }, [calendarMonth, calendarYear, dailyTradeMap, daysInMonth])

  const sortedClosedTrades = useMemo(() => {
    return [...closedTrades].sort((a, b) => {
      const aTs = a.close_date ? new Date(a.close_date).getTime() : 0
      const bTs = b.close_date ? new Date(b.close_date).getTime() : 0
      if (aTs !== bTs) return bTs - aTs
      return b.trade_id - a.trade_id
    })
  }, [closedTrades])

  const botState = (stats?.config.state ?? "").toLowerCase()
  const isBotSetupCompleted = botState !== "pending_setup"
  const entriesPaused = botState === "paused"
  const botRunning = botState === "running"
  const shareEnabled = !!(selectedId && shareStateByBot[selectedId]?.enabled)
  const shareToken = selectedId ? (shareStateByBot[selectedId]?.token ?? "") : ""
  const shareLink = useMemo(() => {
    if (!shareToken) return ""
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    return `${origin}/shared/bot-accounts/${encodeURIComponent(shareToken)}`
  }, [shareToken])

  useEffect(() => {
    if (!selectedId || !activeTrade) {
      setActiveTradeDetail(null)
      setActiveTradeDetailLoading(false)
      return
    }

    let cancelled = false
    setActiveTradeDetailLoading(true)

    fetch(`${apiBase}/${selectedId}/trade?trade_id=${activeTrade.trade.trade_id}`, { cache: "no-store" })
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error((payload as { detail?: string; error?: string } | null)?.detail || (payload as { detail?: string; error?: string } | null)?.error || "Failed to load trade details")
        return payload as FtTradeDetail
      })
      .then((detail) => {
        if (!cancelled) setActiveTradeDetail(detail)
      })
      .catch(() => {
        if (!cancelled) setActiveTradeDetail(null)
      })
      .finally(() => {
        if (!cancelled) setActiveTradeDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeTrade, apiBase, selectedId])

  const todayDate = new Date()
  const today =
    todayDate.getFullYear() === calendarYear && todayDate.getMonth() === calendarMonth
      ? todayDate.getDate()
      : -1

  const balanceChartData = useMemo(() => {
    const sorted = [...closedTrades]
      .filter((t) => !!t.close_date)
      .sort((a, b) => {
        const aTs = new Date(a.close_date).getTime()
        const bTs = new Date(b.close_date).getTime()
        return aTs - bTs
      })

    if (sorted.length === 0) return []

    let runningProfit = 0
    let runningBalance = (stats?.balance_usdt ?? 0) - sorted.reduce((sum, t) => sum + (t.profit_abs ?? 0), 0)

    return sorted.map((t, idx) => {
      const pnl = t.profit_abs ?? 0
      runningProfit += pnl
      runningBalance += pnl
      const dt = new Date(t.close_date)
      const ts = Number.isNaN(dt.getTime()) ? idx : dt.getTime()

      return {
        order: idx + 1,
        ts,
        xLabel: Number.isNaN(dt.getTime())
          ? `#${idx + 1}`
          : dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        label: Number.isNaN(dt.getTime())
          ? `Order ${idx + 1}`
          : dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        pair: t.pair,
        pnl,
        profit: runningProfit,
        balance: runningBalance,
      }
    })
  }, [closedTrades, stats?.balance_usdt])

  const filteredBalanceChartData = useMemo(() => {
    if (chartRange === "All") return balanceChartData
    const now = Date.now()
    const cutoff = chartRange === "7D" ? now - 7 * 86_400_000
      : chartRange === "1M" ? now - 30 * 86_400_000
      : now - 90 * 86_400_000
    return balanceChartData.filter((p) => p.ts >= cutoff)
  }, [balanceChartData, chartRange])

  const accountCurveData = useMemo(() => {
    if (filteredBalanceChartData.length === 0) return []

    const base = filteredBalanceChartData.map((p) => ({ ...p, projected: null as number | null }))
    const lastIdx = base.length - 1
    const last = base[lastIdx]

    base[lastIdx] = { ...last, projected: last.profit }
    base.push({
      ...last,
      ts: last.ts + 60_000,
      order: last.order + 1,
      label: "Projected",
      projected: last.profit + unrealizedPnl,
    })

    return base
  }, [filteredBalanceChartData, unrealizedPnl])

  const runOpenTradeAction = async (trade: FtOpenTrade, action: OpenTradeAction) => {
    if (!selectedId) return

    let endpoint = ""
    let body: Record<string, unknown> = { tradeid: trade.trade_id }

    if (action === "forceexit_limit") {
      endpoint = "forceexit"
      body = { tradeid: trade.trade_id, ordertype: "limit" }
    } else if (action === "forceexit_market") {
      endpoint = "forceexit"
      body = { tradeid: trade.trade_id, ordertype: "market" }
    } else if (action === "forceexit_partial") {
      endpoint = "forceexit"
      const input = window.prompt("Partial close percentage (1-99)", "50")
      if (!input) return
      const percent = Number(input)
      if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
        window.alert("Enter a valid percentage between 1 and 99.")
        return
      }
      body = { tradeid: trade.trade_id, ordertype: "market", amount: percent / 100 }
    } else if (action === "reload") {
      setActionLoadingId(trade.trade_id)
      refetchOpen()
      refetchStats()
      setActionLoadingId(null)
      return
    } else if (action === "delete_trade") {
      const ok = window.confirm(`Delete trade #${trade.trade_id}? This cannot be undone.`)
      if (!ok) return
      endpoint = "delete_trade"
      body = { tradeid: trade.trade_id }
    }

    setActionLoadingId(trade.trade_id)
    try {
      const res = await fetch(`${apiBase}/${selectedId}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((payload as { detail?: string; error?: string }).detail || (payload as { detail?: string; error?: string }).error || "Action failed")
      }

      refetchOpen()
      refetchStats()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed"
      window.alert(msg)
    } finally {
      setActionLoadingId(null)
    }
  }

  const runForceExitAll = async () => {
    if (!selectedId || openTrades.length === 0) return

    const ok = window.confirm(`Force exit all ${openTrades.length} open trade${openTrades.length > 1 ? "s" : ""}?`)
    if (!ok) return

    setForceExitAllLoading(true)
    try {
      const res = await fetch(`${apiBase}/${selectedId}/forceexit_all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordertype: "market" }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((payload as { detail?: string; error?: string }).detail || (payload as { detail?: string; error?: string }).error || "Force exit all failed")
      }

      refetchOpen()
      refetchStats()
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Force exit all failed"
      window.alert(msg)
    } finally {
      setForceExitAllLoading(false)
    }
  }

  useEffect(() => {
    if (publicView || !shareDialogOpen || !selectedId) return

    let cancelled = false
    setShareLoading(true)

    fetch(`/api/bots/${selectedId}/share`, { cache: "no-store" })
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (!res.ok) throw new Error((payload as { detail?: string; error?: string } | null)?.detail || "Failed to load share status")
        return payload as { enabled?: boolean; share_token?: string }
      })
      .then((payload) => {
        if (cancelled) return
        setShareStateByBot((prev) => ({
          ...prev,
          [selectedId]: {
            enabled: !!payload.enabled,
            token: payload.share_token ?? "",
          },
        }))
      })
      .catch(() => {
        if (!cancelled) {
          setShareStateByBot((prev) => ({
            ...prev,
            [selectedId]: {
              enabled: false,
              token: prev[selectedId]?.token ?? "",
            },
          }))
        }
      })
      .finally(() => {
        if (!cancelled) setShareLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [publicView, selectedId, shareDialogOpen])

  const updateShareEnabled = async (enabled: boolean) => {
    if (!selectedId) return
    setShareLoading(true)
    try {
      const res = await fetch(`/api/bots/${selectedId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((payload as { detail?: string; error?: string }).detail || (payload as { detail?: string; error?: string }).error || "Failed to update share setting")
      }

      setShareStateByBot((prev) => ({
        ...prev,
        [selectedId]: {
          enabled: !!(payload as { enabled?: boolean }).enabled,
          token: (payload as { share_token?: string }).share_token ?? prev[selectedId]?.token ?? "",
        },
      }))
      setShareCopied(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update share setting"
      window.alert(msg)
    } finally {
      setShareLoading(false)
    }
  }

  const handleCopyShareLink = async () => {
    if (!shareLink || !shareEnabled) return

    try {
      await navigator.clipboard.writeText(shareLink)
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 2000)
    } catch {
      window.alert("Failed to copy share link")
    }
  }

  const runBotControlAction = async (action: "pause" | "start") => {
    if (!selectedId) return
    setBotControlLoading(action)
    try {
      const res = await fetch(`${apiBase}/${selectedId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((payload as { detail?: string; error?: string }).detail || (payload as { detail?: string; error?: string }).error || "Bot control action failed")
      }

      refetchStats()
      refetchOpen()

      const expectedState = action === "pause" ? "paused" : "running"
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await sleep(1000)

        const stateRes = await fetch(`${apiBase}/${selectedId}/stats`, { cache: "no-store" })
        const statePayload = await stateRes.json().catch(() => null)
        if (!stateRes.ok) continue

        const nextState = ((statePayload as { config?: { state?: string } } | null)?.config?.state ?? "").toLowerCase()
        refetchStats()
        refetchOpen()

        if (nextState === expectedState) {
          break
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bot control action failed"
      window.alert(msg)
    } finally {
      setBotControlLoading(null)
    }
  }

  const handleContinueBotSetup = async () => {
    if (!setupBotId || setupLoading) return

    setSetupLoading(true)
    setSetupError(null)
    setSetupMessage(null)

    try {
      const res = await fetch(`/api/subscription/bots/${encodeURIComponent(setupBotId)}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        detail?: string
        message?: string
        setup?: {
          server_ip?: string
          backend_server_ip?: string
          deploy_enabled?: boolean
          deploy_unavailable_reason?: string
          status?: string
          last_step?: string
          last_error?: string
          history?: Array<{ step?: string; status?: string; message?: string; timestamp?: string }>
        }
      }

      if (!res.ok) {
        throw new Error(payload.error || payload.detail || payload.message || "Bot setup failed")
      }

      const setup = payload.setup ?? null
      setSetupState(setup)
      const ip = setup?.server_ip || "-"
      const statusText = setup?.status ? `Status: ${setup.status}` : "Status: updated"
      setSetupMessage(`${payload.message || "Bot setup updated"} | Server IP: ${ip} | ${statusText}`)
      setSetupError(setup?.last_error || null)
      if (setup?.server_ip) {
        setPipelineStep(2)
      }
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Bot setup failed")
    } finally {
      setSetupLoading(false)
    }
  }

  const handleCopyIp = async (ip: string, field: "created" | "backend") => {
    const normalized = String(ip || "").trim()
    if (!normalized) return

    try {
      await navigator.clipboard.writeText(normalized)
      setCopiedIpField(field)
      setSetupMessage(`${field === "created" ? "Created Server IP" : "Backend Server IP"} copied: ${normalized}`)
      window.setTimeout(() => setCopiedIpField(null), 2000)
    } catch {
      setSetupError("Failed to copy IP")
    }
  }

  const handleValidateBinanceApi = async () => {
    if (!setupBotId || setupValidateLoading) return

    const apiKey = binanceApiKey.trim()
    const apiSecret = binanceApiSecret.trim()
    const validationRoute = botExchange === "Bybit" ? "validate-bybit" : "validate-binance"
    const exchangeLabel = botExchange === "Bybit" ? "Bybit" : "Binance"

    setSetupValidateLoading(true)
    setSetupError(null)
    setSetupMessage(null)

    try {
      const res = await fetch(`/api/subscription/bots/${encodeURIComponent(setupBotId)}/setup/${validationRoute}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      })

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        detail?: string
        message?: string
        setup?: {
          server_ip?: string
          backend_server_ip?: string
          deploy_enabled?: boolean
          deploy_unavailable_reason?: string
          status?: string
          last_step?: string
          last_error?: string
          history?: Array<{ step?: string; status?: string; message?: string; timestamp?: string }>
        }
      }

      if (!res.ok) {
        throw new Error(payload.error || payload.detail || payload.message || `${exchangeLabel} API validation failed`)
      }

      const setup = payload.setup ?? null
      setSetupState(setup)
      setPipelineStep(3)
      setSetupMessage(payload.message || `${exchangeLabel} API validated`)
      setSetupError(setup?.last_error || null)
      if (setup?.status === "completed") {
        setPipelineStep(3)
        refetchStats()
        refetchOpen()
      }
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : `${exchangeLabel} API validation failed`)
    } finally {
      setSetupValidateLoading(false)
    }
  }

  const handleDeployBot = async () => {
    if (!setupBotId || setupDeployLoading) return

    setSetupDeployLoading(true)
    setSetupError(null)
    setSetupMessage(null)

    try {
      const deployPayload = await deployBotFlow({ dryRun: botIsDemo })

      setSetupState(deployPayload.setup ?? null)
      setSetupMessage(deployPayload.message || "Bot deployed")
      setSetupError(deployPayload.setup?.last_error || null)
      refetchStats()
      refetchOpen()
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Bot deployment failed")
    } finally {
      setSetupDeployLoading(false)
    }
  }

  const deployBotFlow = async ({ dryRun, apiKey, apiSecret }: { dryRun: boolean; apiKey?: string; apiSecret?: string }) => {
    if (!setupBotId) {
      throw new Error("Bot setup is not ready")
    }

    const res = await fetch(`/api/subscription/bots/${encodeURIComponent(setupBotId)}/setup/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyName: selectedStrategyName,
        dryRun,
        apiKey: apiKey ?? "",
        apiSecret: apiSecret ?? "",
      }),
    })

    const payload = (await res.json().catch(() => ({}))) as {
      error?: string
      detail?: string
      message?: string
      setup?: {
        server_ip?: string
        backend_server_ip?: string
        status?: string
        last_step?: string
        last_error?: string
        history?: Array<{ step?: string; status?: string; message?: string; timestamp?: string }>
      }
    }

    if (!res.ok) {
      throw new Error(payload.error || payload.detail || payload.message || "Bot deployment failed")
    }

    return payload
  }

  const handleDeleteBot = async () => {
    if (!selectedId || deleteLoading) return

    setDeleteLoading(true)
    setSetupError(null)

    try {
      const res = await fetch(`/api/subscription/bots/${encodeURIComponent(selectedId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      })

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        detail?: string
        message?: string
      }

      if (!res.ok) {
        throw new Error(payload.error || payload.detail || payload.message || "Failed to delete bot")
      }

      setDeleteDialogOpen(false)
      window.location.reload()
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to delete bot")
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleCopyExchangeIps = async () => {
    if (!exchangeWhitelistIps) return
    try {
      await navigator.clipboard.writeText(exchangeWhitelistIps)
      setExchangeIpsCopied(true)
      window.setTimeout(() => setExchangeIpsCopied(false), 2000)
    } catch {
      setSetupError("Failed to copy IP list")
    }
  }

  const handleConnectExchange = async () => {
    if (!setupBotId || exchangeConnectLoading) return

    const apiKey = exchangeApiKeyInput.trim()
    const apiSecret = exchangeApiSecretInput.trim()
    const exchangeLabel = botExchange === "Bybit" ? "Bybit" : "Binance"
    const validateRoute = botExchange === "Bybit" ? "validate-bybit" : "validate-binance"

    if (!apiKey || !apiSecret) {
      setSetupError(`Please enter ${exchangeLabel} API key and secret`)
      return
    }

    setExchangeConnectLoading(true)
    setExchangeConnectStage("validating")
    setSetupError(null)
    setSetupMessage(null)

    try {
      const validateRes = await fetch(`/api/subscription/bots/${encodeURIComponent(setupBotId)}/setup/${validateRoute}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      })

      const validatePayload = (await validateRes.json().catch(() => ({}))) as {
        error?: string
        detail?: string
        message?: string
        setup?: {
          status?: string
          last_error?: string
        }
      }

      if (!validateRes.ok) {
        throw new Error(validatePayload.error || validatePayload.detail || validatePayload.message || `${exchangeLabel} API validation failed`)
      }

      setExchangeConnectStage("switching")

      const deployPayload = await deployBotFlow({ dryRun: false, apiKey, apiSecret })

      setSetupMessage(`${exchangeLabel} connected. Bot switched to live mode and keys saved in Settings Connections.`)
      setSetupError(deployPayload.setup?.last_error || null)
      setExchangePanelOpen(false)
      void refreshSetupState()
      refetchStats()
      refetchOpen()
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to connect exchange")
    } finally {
      setExchangeConnectLoading(false)
      setExchangeConnectStage(null)
    }
  }

  const handleSwitchToDryRun = async () => {
    if (!setupBotId || switchToDryRunLoading) return

    setSwitchToDryRunLoading(true)
    setSetupError(null)
    setSetupMessage(null)

    try {
      const deployPayload = await deployBotFlow({ dryRun: true })

      setSetupMessage("Bot switched from live to dry run mode.")
      setSetupError(deployPayload.setup?.last_error || null)
      setSwitchToDryRunDialogOpen(false)
      void refreshSetupState()
      refetchStats()
      refetchOpen()
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to switch bot to dry run mode")
    } finally {
      setSwitchToDryRunLoading(false)
    }
  }

  const handleSaveBotSettings = async () => {
    if (!setupBotId || settingsSaving) return

    if (!setupState?.server_ip) {
      setSetupError("Server is not ready yet. Complete setup first, then apply bot settings.")
      return
    }

    if (settingsForm.tradeType === "fixed" && (!Number.isFinite(settingsForm.stakeAmount) || settingsForm.stakeAmount <= 0)) {
      setSetupError("Stake amount must be greater than 0 for Fixed trade type")
      return
    }

    setSettingsSaving(true)
    setSetupError(null)
    setSetupMessage(null)

    try {
      const payload = {
        tradeType: settingsForm.tradeType,
        dcaMode: settingsForm.dcaMode,
        stakeAmount: settingsForm.tradeType === "fixed" ? settingsForm.stakeAmount : null,
        maxOpenOrder: settingsForm.maxOpenOrder,
        stoplossPct: settingsForm.stoplossPct,
        dcaStoplossPct: settingsForm.dcaStoplossPct,
        entry30mEnabled: settingsForm.entry30mEnabled,
        entry1hEnabled: settingsForm.entry1hEnabled,
        entry4hEnabled: settingsForm.entry4hEnabled,
        useChgFilter: settingsForm.useChgFilter,
        chg30mEnabled: settingsForm.chg30mEnabled,
        chg1hEnabled: settingsForm.chg1hEnabled,
        chg4hEnabled: settingsForm.chg4hEnabled,
        chg30mMin: settingsForm.chg30mMin,
        chg30mMax: settingsForm.chg30mMax,
        chg1hMin: settingsForm.chg1hMin,
        chg1hMax: settingsForm.chg1hMax,
        chg4hMin: settingsForm.chg4hMin,
        chg4hMax: settingsForm.chg4hMax,
        dcaChg30mMin: settingsForm.dcaChg30mMin,
        dcaChg30mMax: settingsForm.dcaChg30mMax,
        dcaChg1hMin: settingsForm.dcaChg1hMin,
        dcaChg1hMax: settingsForm.dcaChg1hMax,
        dcaChg4hMin: settingsForm.dcaChg4hMin,
        dcaChg4hMax: settingsForm.dcaChg4hMax,
        chg30mExitBuffer: settingsForm.chg30mExitBuffer,
        chg1hExitBuffer: settingsForm.chg1hExitBuffer,
        chg4hExitBuffer: settingsForm.chg4hExitBuffer,
        dcaReentryMinProfit: settingsForm.dcaReentryMinProfit / 100,
        dcaReentryMaxDrawdown: settingsForm.dcaReentryMaxDrawdown / 100,
        leverage: settingsForm.leverage,
      }
      console.log("[Bot Settings] Sending payload:", payload)

      const saveRes = await fetch(`/api/subscription/bots/${encodeURIComponent(setupBotId)}/setup/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const savePayload = (await saveRes.json().catch(() => ({}))) as {
        error?: string
        detail?: string
        message?: string
        setup?: {
          last_error?: string
        }
      }

      console.log("[Bot Settings] Save response:", { status: saveRes.status, payload: savePayload })

      if (!saveRes.ok) {
        const errorMsg =
          savePayload.error ||
          savePayload.detail ||
          savePayload.message ||
          (saveRes.status === 504
            ? "Gateway timeout while saving bot settings. Please retry in a few seconds."
            : `Failed to save bot settings (HTTP ${saveRes.status})`)
        console.error("[Bot Settings] Save failed:", errorMsg)
        throw new Error(errorMsg)
      }

      const deployPayload = await deployBotFlow({ dryRun: !isBotLiveMode })

      console.log("[Bot Settings] Deploy response:", { status: "ok", payload: deployPayload })

      setSetupMessage("Bot settings saved, config/strategy updated, and bot restarted.")
      setSetupError(deployPayload.setup?.last_error || null)
      setSettingsPanelOpen(false)
      void refreshSetupState()
      refetchStats()
      refetchOpen()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to apply bot settings"
      console.error("[Bot Settings] Handler error:", errorMsg, err)
      setSetupError(errorMsg)
    } finally {
      setSettingsSaving(false)
    }
  }

  return (
    <div data-name="my-bots-page" className="min-h-[calc(100vh-96px)] border border-border bg-background text-foreground rounded-lg">
      <div data-name="my-bots-layout" className={cn("relative grid min-h-[calc(100vh-96px)] grid-cols-1", publicView ? "xl:grid-cols-1" : isPanelCollapsed ? "xl:grid-cols-[72px_minmax(0,1fr)]" : "xl:grid-cols-[420px_minmax(0,1fr)]")}>
        {!publicView && <aside data-name="my-bots-sidebar" className="border-b border-border p-6 transition-all duration-300 xl:border-b-0 xl:border-r">
          {!isPanelCollapsed ? (
            <>
              <div data-name="my-bots-sidebar-header" className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
                  T
                </div>
                <div>
                  <h1 className="text-[20px] font-semibold tracking-tight">Hey, TamilSelvan</h1>
                  <p className="text-sm text-muted-foreground">Manage your active bots, drafts, and new purchases.</p>
                </div>
              </div>

              {showPaymentBanner && (
                <div className="mt-4 space-y-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-emerald-300">Payment completed successfully</p>
                      <p className="text-xs text-emerald-200/80">Your purchased bot has been added to My Bots.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPaymentBanner(false)}
                      className="text-emerald-200/80 hover:text-emerald-100"
                      aria-label="Dismiss payment success message"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>

                  {setupError && <p className="text-xs text-red-300">{setupError}</p>}
                </div>
              )}

              <Button asChild className="mt-6 h-12 w-full rounded-xl bg-[#4a67ff] text-[15px] font-semibold text-white hover:bg-[#5771ff]">
                <Link href="/new-bot">
                  <Rocket className="h-4 w-4" />
                  Buy Bot
                </Link>
              </Button>

              <div data-name="my-bots-filters" className="mt-5 flex flex-wrap items-center gap-2">
                <label className="relative">
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    className={cn(selectClassName, typeFilter !== FILTER_ALL && "border-primary text-foreground font-medium")}
                  >
                    {[FILTER_ALL, "Demo", "Real"].map((option) => (
                      <option key={option} value={option}>
                        {option === FILTER_ALL ? "All Types" : option}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-muted-foreground" />
                </label>

                <label className="relative">
                  <select
                    value={exchangeFilter}
                    onChange={(event) => setExchangeFilter(event.target.value)}
                    className={cn(selectClassName, exchangeFilter !== FILTER_ALL && "border-primary text-foreground font-medium")}
                  >
                    {[FILTER_ALL, "Binance", "Bybit"].map((option) => (
                      <option key={option} value={option}>
                        {option === FILTER_ALL ? "All Exchanges" : option}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-muted-foreground" />
                </label>

                <label className="relative">
                  <select
                    value={stateFilter}
                    onChange={(event) => setStateFilter(event.target.value)}
                    className={cn(selectClassName, stateFilter !== FILTER_ALL && "border-primary text-foreground font-medium")}
                  >
                    {[FILTER_ALL, "Running", "Paused", "Completed"].map((option) => (
                      <option key={option} value={option}>
                        {option === FILTER_ALL ? "All States" : option}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-muted-foreground" />
                </label>

                <label className="relative">
                  <select
                    value={archiveDisplayFilter}
                    onChange={(event) => setArchiveDisplayFilter(event.target.value)}
                    className={cn(selectClassName, archiveDisplayFilter !== FILTER_ALL && "border-primary text-foreground font-medium")}
                  >
                    {[FILTER_ALL, "Unarchived", "Archived"].map((option) => (
                      <option key={option} value={option}>
                        {option === FILTER_ALL ? "All Bots" : option}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 rotate-90 text-muted-foreground" />
                </label>
              </div>

              <div data-name="my-bots-view-toggle" className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode("cards")}
                  aria-label="Extended view"
                  aria-pressed={viewMode === "cards"}
                  className={cn(
                    "relative flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                    viewMode === "cards"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  aria-label="Compact view"
                  aria-pressed={viewMode === "list"}
                  className={cn(
                    "relative flex h-8 w-8 items-center justify-center rounded-full border transition-colors",
                    viewMode === "list"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>

              <div data-name="my-bots-list" className="mt-4 space-y-3">
                {botsLoading && (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Spinner /> Loading bots…
                  </div>
                )}
                {filteredBots.map((b) => {
                  const isSelected = b.id === selectedId
                  return (
                    <BotSummaryCard
                      key={b.id}
                      bot={b}
                      isSelected={isSelected}
                      viewMode={viewMode}
                      statsOverride={isSelected ? stats : null}
                      onSelect={() => setSelectedId(b.id)}
                      archived={Boolean(archivedBots[b.id])}
                      onToggleArchived={toggleArchived}
                    />
                  )
                })}

                {!botsLoading && filteredBots.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
                    No bots found.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="hidden h-full flex-col items-center gap-4 xl:flex">
              <Button
                type="button"
                size="icon"
                asChild
                className="h-10 w-10 rounded-xl bg-[#4a67ff] text-white hover:bg-[#5771ff]"
                aria-label="Buy bot"
              >
                <Link href="/new-bot">
                  <Rocket className="h-4 w-4" />
                </Link>
              </Button>

              <button
                type="button"
                onClick={() => setIsPanelCollapsed(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:border-primary"
                aria-label="Expand bot panel"
              >
                <List className="h-4 w-4" />
              </button>

              <div className="mt-2 text-[11px] text-muted-foreground [writing-mode:vertical-rl]">
                {filteredBots.length} BOTS
              </div>
            </div>
          )}
        </aside>}

        {!publicView && <button
          type="button"
          onClick={() => setIsPanelCollapsed((prev) => !prev)}
          aria-label={isPanelCollapsed ? "Expand bot panel" : "Collapse bot panel"}
          className="absolute left-[60px] top-10 z-20 hidden h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-[0_4px_14px_rgba(0,0,0,0.2)] hover:border-primary xl:flex"
          style={{ left: isPanelCollapsed ? 60 : 408 }}
        >
          {isPanelCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>}

        <section data-name="my-bots-detail-section" className="flex items-center justify-center p-6 lg:p-10">
          {bot && statsLoading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Loading bot data…</p>
            </div>
          ) : bot && statsError ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <p className="text-sm text-red-400">{statsError}</p>
              <button type="button" onClick={refetchStats} className="rounded-lg border border-border px-4 py-2 text-xs text-foreground hover:border-primary">
                Retry
              </button>
            </div>
          ) : bot && stats ? (
            <div data-name="my-bots-detail-content" className="w-full max-w-[1200px] space-y-4">
              {/* Breadcrumb + actions */}
              <div data-name="my-bots-breadcrumb-actions" className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div data-name="my-bots-breadcrumb" className="flex items-center gap-1">
                  {publicView ? <><span>Shared</span><span>&gt;</span><span>Trading Accounts</span><span>&gt;</span></> : <><span>Home</span><span>&gt;</span><span>Bots</span><span>&gt;</span></>}
                  <span className="font-medium text-foreground">{fmtBotDisplayId(bot.id)}</span>
                </div>
                {!publicView && isBotSetupCompleted && <div data-name="my-bots-top-actions" className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => runBotControlAction("start")}
                    disabled={botControlLoading !== null || (botRunning && !entriesPaused)}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-60",
                      entriesPaused
                        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:border-emerald-300/60"
                        : "border-border bg-background text-foreground hover:border-primary"
                    )}
                  >
                    {botControlLoading === "start" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Start
                  </button>
                  <button
                    type="button"
                    onClick={() => runBotControlAction("pause")}
                    disabled={botControlLoading !== null || entriesPaused}
                    className="flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:border-primary disabled:opacity-60"
                  >
                    {botControlLoading === "pause" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                    Pause
                  </button>
                  <button
                    type="button"
                    onClick={() => { refetchStats(); refetchOpen(); }}
                    className="flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:border-primary"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Refresh
                  </button>
                  <Button
                    variant="outline"
                    className="h-7 rounded-lg border-border px-3 text-xs"
                    onClick={() => {
                      if (isBotLiveMode) {
                        setSwitchToDryRunDialogOpen(true)
                        return
                      }
                      setExchangePanelOpen(true)
                    }}
                  >
                    <Wallet className="h-3 w-3" /> {isBotLiveMode ? "Switch" : "Exchange"}
                  </Button>
                  <Button variant="outline" className="h-7 rounded-lg border-border px-3 text-xs" onClick={() => setSettingsPanelOpen(true)}>
                    <SlidersHorizontal className="h-3 w-3" /> Settings
                  </Button>
                  <Button variant="outline" className="h-7 rounded-lg border-border px-3 text-xs" onClick={() => setShareDialogOpen(true)}>
                    <Share2 className="h-3 w-3" /> Share
                  </Button>
                  <Button
                    variant="outline"
                    className="h-7 rounded-lg border-red-500/40 px-3 text-xs text-red-300 hover:border-red-500/70 hover:bg-red-500/10 hover:text-red-200"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </Button>
                </div>}
              </div>

              {!publicView && setupBotId && !isDeployCompleted && (
                <div data-name="setup-pipeline-section" className="rounded-lg border border-border bg-card p-4">
                  <div data-name="setup-pipeline-header" className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div data-name="setup-pipeline-header-text">
                      <h3 className="text-sm font-semibold text-foreground">Setup Pipeline</h3>
                      <p className="text-xs text-muted-foreground">
                        {botIsDemo
                          ? `Step 1 creates the server. Step 2 deploys the bot. API validation is not required for demo bots.`
                          : showCreatedServerIp
                          ? `Step 1 creates the server and shows IPs to whitelist. Step 2 validates your ${botExchange} API. Step 3 deploys the bot.`
                          : `Step 1 creates the server. Step 2 validates your ${botExchange} API. Step 3 deploys the bot.`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {setupState?.status === "completed" && (
                        <Badge className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300">Setup Completed</Badge>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 rounded-lg px-2 text-xs"
                        onClick={() => void refreshSetupState()}
                        disabled={setupInstallerLoading}
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", setupInstallerLoading && "animate-spin")} />
                        Refresh Status
                      </Button>
                    </div>
                  </div>

                  <div data-name="setup-installer-steps" className={cn("mt-4 grid gap-2", showApiStep ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
                    {(showApiStep
                      ? [
                          { number: 1, title: "Create Server" },
                          { number: 2, title: "Validate API" },
                          { number: 3, title: "Deploy Bot" },
                        ]
                      : [
                          { number: 1, title: "Create Server" },
                          { number: 3, title: "Deploy Bot" },
                        ]
                    ).map((step, displayIndex) => {
                      const unlockedStep = showApiStep
                        ? (isApiStepCompleted ? 3 : isServerCreated ? 2 : 1)
                        : (isServerCreated ? 3 : 1)
                      const isUnlocked = step.number <= unlockedStep
                      const isCurrent = pipelineStep === step.number || (!showApiStep && pipelineStep === 2 && step.number === 3)
                      const isDone = step.number === 1 ? isServerCreated : step.number === 2 ? isApiStepCompleted : isDeployCompleted

                      return (
                        <button
                          key={step.number}
                          type="button"
                          onClick={() => {
                            if (isUnlocked || step.number === pipelineStep) {
                              setPipelineStep(step.number as 1 | 2 | 3)
                            }
                          }}
                          disabled={!isUnlocked && !isCurrent}
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left transition-colors",
                            isCurrent
                              ? "border-blue-400/40 bg-blue-500/10"
                              : isDone
                              ? "border-emerald-400/30 bg-emerald-500/10"
                              : "border-border bg-muted/20",
                            !isUnlocked && !isCurrent && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <p className="text-[11px] text-muted-foreground">Step {displayIndex + 1}</p>
                          <p className="text-sm font-semibold text-foreground">{step.title}</p>
                        </button>
                      )
                    })}
                  </div>

                  {setupInstallerLoading && (
                    <div data-name="setup-installer-preloader" className="mt-3 rounded-lg border border-blue-400/25 bg-blue-500/10 p-3">
                      <div className="flex items-center gap-2 text-xs text-blue-200">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>{setupInstallerLoadingText || "Processing..."}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-900/40">
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400" />
                      </div>
                    </div>
                  )}

                  {pipelineStep === 1 && (
                    <div data-name="setup-installer-step-1" className="mt-4 rounded-lg border border-blue-400/20 bg-blue-500/5 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">Step 1: Continue to Create Server and Server IPs</p>
                        <Button
                          type="button"
                          onClick={handleContinueBotSetup}
                          disabled={setupLoading || setupState?.status === "completed" || isServerCreated}
                          className="h-9 rounded-lg bg-[#4a67ff] text-white hover:bg-[#5771ff] disabled:opacity-50"
                        >
                          {setupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {setupLoading ? "Creating Server..." : isServerCreated ? "Server Created" : "Continue"}
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {showCreatedServerIp
                          ? "Create your server first. Then copy and whitelist the two IPs below in your exchange API settings."
                          : "Create your server. No IP whitelisting required for this bot type."}
                      </p>

                      {showCreatedServerIp && (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-[11px] text-muted-foreground">IP 1 (Created IP)</p>
                            <div className="flex items-center gap-2">
                              <Input value={setupState?.server_ip || ""} readOnly placeholder="-" className="h-9" />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleCopyIp(setupState?.server_ip || "", "created")}
                                disabled={!setupState?.server_ip}
                                className="h-9 rounded-lg"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                {copiedIpField === "created" ? "Copied" : "Copy"}
                              </Button>
                            </div>
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] text-muted-foreground">IP 2 (Fixed)</p>
                            <div className="flex items-center gap-2">
                              <Input value="167.71.232.153" readOnly className="h-9" />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleCopyIp("167.71.232.153", "backend")}
                                className="h-9 rounded-lg"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                {copiedIpField === "backend" ? "Copied" : "Copy"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex justify-end">
                        <Button
                          type="button"
                          onClick={() => setPipelineStep(showApiStep ? 2 : 3)}
                          disabled={!isServerCreated}
                          className="h-9 rounded-lg bg-[#4a67ff] text-white hover:bg-[#5771ff] disabled:opacity-50"
                        >
                          {showApiStep ? "Next: Validate API" : "Next: Deploy Bot"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {pipelineStep === 2 && showApiStep && (
                    <div data-name="setup-installer-step-2" className={cn("mt-4 rounded-lg border p-4", isServerCreated ? "border-amber-400/20 bg-amber-500/5" : "border-border bg-muted/20")}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">Step 2: Validate API</p>
                        <Button
                          type="button"
                          onClick={handleValidateBinanceApi}
                          disabled={setupValidateLoading || !isServerCreated || setupState?.status === "completed" || isApiValidated}
                          className="h-9 rounded-lg bg-[#4a67ff] text-white hover:bg-[#5771ff] disabled:opacity-50"
                        >
                          {setupValidateLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {setupValidateLoading ? "Validating..." : isApiStepCompleted ? "Validated" : `Validate ${botExchange} API`}
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Enter your {botExchange} API key/secret (or leave empty if already saved in Connections), then validate.</p>
                      {botExchange === "Binance" && (
                        <p className="mt-1 text-xs text-amber-400/80">&#9432; This validation step currently supports Binance Futures only.</p>
                      )}
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Input
                          value={binanceApiKey}
                          onChange={(event) => setBinanceApiKey(event.target.value)}
                          placeholder={`${botExchange} API Key`}
                          disabled={!isServerCreated || setupState?.status === "completed" || isApiValidated}
                        />
                        <Input
                          value={binanceApiSecret}
                          onChange={(event) => setBinanceApiSecret(event.target.value)}
                          placeholder={`${botExchange} API Secret`}
                          type="password"
                          disabled={!isServerCreated || setupState?.status === "completed" || isApiValidated}
                        />
                      </div>

                      {isApiValidated && setupState?.server_ip && (
                        <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-500/5 p-4">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-400">Bot API Connection</p>
                          <div className="space-y-1.5 font-mono text-[11px]">
                            {[
                              { key: "BOT_API_URL", value: `http://${setupState?.server_ip ?? "-"}:18080` },
                              { key: "BOT_API_USERNAME", value: "admin" },
                              { key: "BOT_API_PASSWORD", value: "admin" },
                              { key: "BOT_ID", value: setupBotId ?? "bot-1" },
                              { key: "BOT_NAME", value: displayBotId },
                            ].map(({ key, value }) => (
                              <div key={key} className="flex items-center gap-1.5">
                                <span className="text-emerald-300">{key}</span>
                                <span className="text-muted-foreground">=</span>
                                <span className="text-zinc-200">{value}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex justify-between">
                        <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => setPipelineStep(1)}>
                          Back
                        </Button>
                        <Button
                          type="button"
                          onClick={() => setPipelineStep(3)}
                          disabled={!isApiStepCompleted}
                          className="h-9 rounded-lg bg-[#4a67ff] text-white hover:bg-[#5771ff] disabled:opacity-50"
                        >
                          Next: Deploy Bot
                        </Button>
                      </div>
                    </div>
                  )}

                  {(pipelineStep === 3 || (pipelineStep >= 2 && !showApiStep)) && (
                    <div data-name="setup-installer-step-3" className={cn("mt-4 rounded-lg border p-4", isApiStepCompleted ? "border-emerald-400/20 bg-emerald-500/5" : "border-border bg-muted/20")}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">Step 3: Deploy Bot</p>
                        <Button
                          type="button"
                          onClick={handleDeployBot}
                          disabled={
                            !deployStepAvailable ||
                            setupDeployLoading ||
                            !isServerCreated ||
                            (!isApiStepCompleted && setupState?.status !== "completed") ||
                            isDeployCompleted
                          }
                          className="h-9 rounded-lg bg-[#1f9f6f] text-white hover:bg-[#25b47d] disabled:opacity-50"
                        >
                          {setupDeployLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          {setupDeployLoading ? "Deploying..." : isDeployCompleted ? "Deployed" : "Deploy Trading Bot"}
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Creates docker files, uploads strategy/config, starts container, and validates bot API.</p>
                      {!deployStepAvailable && (
                        <p className="mt-2 text-xs text-amber-300">{setupState?.deploy_unavailable_reason || "Deployment is currently unavailable."}</p>
                      )}
                      <div className="mt-4 flex justify-start">
                        <Button type="button" variant="outline" className="h-9 rounded-lg" onClick={() => setPipelineStep(showApiStep ? 2 : 1)}>
                          Back
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span>Current Step: {(setupState?.last_step || "pending").replace(/_/g, " ")}</span>
                    <span>Status: {setupState?.status || "pending"}</span>
                  </div>

                  {setupMessage && <p className="mt-3 text-xs text-emerald-400">{setupMessage}</p>}
                  {!!setupError && !(
                    setupState?.deploy_enabled === false &&
                    (setupError || "").toLowerCase().includes("deploy ssh private key path is not configured")
                  ) && <p className="mt-3 text-xs text-red-400">{setupError}</p>}
                </div>
              )}

              {isBotSetupCompleted ? (
                <>
              {/* Overview cards */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {overviewCards.map((c) => (
                  <div key={c.label} className="rounded-lg border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className={cn("mt-1 text-xl font-semibold text-foreground", c.valueClassName)}>{c.value}</p>
                  </div>
                ))}
              </div>

              {/* Trade performance + balance bars */}
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="rounded-lg border border-primary/30 bg-gradient-to-r from-indigo-600/90 to-blue-500/90 p-5 text-white">
                  <p className="text-xs opacity-80">Trade Performance</p>
                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs opacity-70">Win Rate</p>
                      <p className="mt-1 text-2xl font-semibold">{fmtPct(stats.profit.winrate)}</p>
                    </div>
                    <div>
                      <p className="text-xs opacity-70">Profit Factor</p>
                      <p className="mt-1 text-2xl font-semibold">{fmt(stats.profit.profit_factor, 1)}</p>
                    </div>
                    <div>
                      <p className="text-xs opacity-70">Total Trades</p>
                      <p className="mt-1 text-2xl font-semibold">{stats.profit.trade_count}</p>
                    </div>
                    <div>
                      <p className="text-xs opacity-70">Best Pair</p>
                      <p className="mt-1 text-sm font-medium">{stats.profit.best_pair}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-border bg-card p-4">
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Total Balance</span>
                      <span className="text-foreground">{fmtUsd(stats.balance_usdt)}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div className="h-2 rounded-full bg-primary" style={{ width: "100%" }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>In Use</span>
                      <span className="text-foreground">{fmtUsd(stats.used_usdt)}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-amber-400"
                        style={{ width: `${Math.min(100, stats.balance_usdt > 0 ? (stats.used_usdt / stats.balance_usdt) * 100 : 0)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Free</span>
                      <span className="text-foreground">{fmtUsd(stats.free_usdt)}</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, stats.balance_usdt > 0 ? (stats.free_usdt / stats.balance_usdt) * 100 : 0)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Account Balance */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Account Balance</h3>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#C3CBD8]" />
                      Profit
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#FF5A67]" />
                      Projected profit (incl. unrealized)
                    </span>
                  </div>
                </div>

                {accountCurveData.length > 0 ? (
                  <>
                  <div className="h-[320px] rounded-lg border border-border bg-background px-2 pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <RLineChart data={accountCurveData}>
                        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.35} />
                        <XAxis
                          type="number"
                          dataKey="ts"
                          domain={["dataMin", "dataMax"]}
                          tickFormatter={(value) => new Date(Number(value)).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={28}
                        />
                        <YAxis
                          tickFormatter={(value) => fmtUsd(Number(value))}
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          width={52}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 10,
                            color: "hsl(var(--foreground))",
                          }}
                          formatter={(value, name) => {
                            const numericValue = toSafeNumber(value)
                            const seriesName = String(name)
                            if (seriesName === "profit") return [fmtUsd(numericValue), "Profit"]
                            if (seriesName === "projected") return [fmtUsd(numericValue), "Projected profit (incl. unrealized)"]
                            if (seriesName === "pnl") return [fmtUsd(numericValue), "Order P&L"]
                            return [String(value ?? ""), seriesName]
                          }}
                          labelFormatter={(label, payload) => {
                            const row = payload?.[0]?.payload as { label?: string; pair?: string } | undefined
                            return `${row?.pair ? `${row.pair} • ` : ""}${row?.label ?? `Order ${label}`}`
                          }}
                        />
                        <Line
                          type="stepAfter"
                          dataKey="profit"
                          stroke="#C3CBD8"
                          strokeWidth={2.4}
                          dot={false}
                          activeDot={{ r: 4, fill: "#ffffff", stroke: "#94A3B8", strokeWidth: 2 }}
                        />
                        <Line
                          type="linear"
                          dataKey="projected"
                          stroke="#FF5A67"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#FF5A67" }}
                          activeDot={{ r: 4, fill: "#ffffff", stroke: "#FF5A67", strokeWidth: 2 }}
                          connectNulls
                        />
                      </RLineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-3 flex items-center justify-between px-1">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-md bg-[#4F7BFF] px-2 py-1 text-[11px] font-semibold text-white">
                        {filteredBalanceChartData.length > 0 ? fmtUsd(filteredBalanceChartData[filteredBalanceChartData.length - 1].profit) : fmtUsd(0)} Profit
                      </span>
                      <span className="rounded-md bg-[#FF5A67] px-2 py-1 text-[11px] font-semibold text-white">
                        {filteredBalanceChartData.length > 0 ? fmtUsd(filteredBalanceChartData[filteredBalanceChartData.length - 1].profit + unrealizedPnl) : fmtUsd(0)} Projected profit (incl. unrealized)
                      </span>
                      <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold text-foreground">
                        {filteredBalanceChartData.length} Orders
                      </span>
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
                      {(["7D", "1M", "3M", "All"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setChartRange(r)}
                          className={cn(
                            "rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                            chartRange === r
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  </>
                ) : (
                  <div className="grid h-52 place-items-center rounded-lg border border-dashed border-border bg-background text-center text-muted-foreground">
                    <div>
                      <BarChart3 className="mx-auto h-5 w-5" />
                      <p className="mt-2 text-sm">No balance data available</p>
                    </div>
                  </div>
                )}
              </div>



              {/* Extended profit stats */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Avg Duration</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{stats.profit.avg_duration}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Expectancy</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{fmt(stats.profit.expectancy, 4)}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Sharpe Ratio</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{fmt(stats.profit.sharpe, 2)}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Max Drawdown (abs)</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{fmtUsd(stats.profit.max_drawdown_abs)}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Winning Trades</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-400">{stats.profit.winning_trades}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Losing Trades</p>
                  <p className="mt-1 text-lg font-semibold text-red-400">{stats.profit.losing_trades}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Trading Volume</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{fmtUsd(stats.profit.trading_volume)}</p>
                </div>
              </div>

              {/* Daily Calendar Summary */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-foreground">Daily Summary</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      className="h-7 rounded-md border-border px-2 text-xs"
                      onClick={() => setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <label className="relative">
                      <CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <select
                        value={calendarMonth}
                        onChange={(event) => setCalendarCursor(new Date(calendarYear, Number(event.target.value), 1))}
                        className="h-7 rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground"
                      >
                        {monthOptions.map((name, idx) => (
                          <option key={name} value={idx}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <select
                      value={calendarYear}
                      onChange={(event) => setCalendarCursor(new Date(Number(event.target.value), calendarMonth, 1))}
                      className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                    >
                      {calendarYears.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      className="h-7 rounded-md border-border px-2 text-xs"
                      onClick={() => setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="grid grid-cols-7 gap-1">
                    {monthDays.map((day, index) => {
                      const dayEntry = day !== null ? dailyTradeMap.get(day) : undefined
                      const hasTrades = !!dayEntry
                      const dayPositive = (dayEntry?.pnl ?? 0) >= 0

                      return (
                        <div
                          key={`${day ?? "empty"}-${index}`}
                          className={cn(
                            "flex h-16 flex-col rounded-md border border-border bg-background p-1.5 text-xs",
                            day === null && "opacity-40",
                            day === today && "border-primary/70 bg-primary/10 text-foreground",
                            hasTrades && dayPositive && "border-emerald-500/40 bg-emerald-500/10",
                            hasTrades && !dayPositive && "border-red-500/40 bg-red-500/10",
                          )}
                        >
                          <div className="flex items-start justify-end text-muted-foreground">{day ?? ""}</div>
                          {hasTrades && (
                            <div className={cn("mt-auto space-y-0.5 text-[10px]", dayPositive ? "text-emerald-300" : "text-red-300")}>
                              <div className="flex items-center gap-1">
                                <span className={cn("h-1.5 w-1.5 rounded-full", dayPositive ? "bg-emerald-400" : "bg-red-400")} />
                                {dayEntry?.count} trades
                              </div>
                              <div className="font-medium">
                                {dayEntry && dayEntry.pnl >= 0 ? "+" : ""}{fmtUsd(dayEntry?.pnl ?? 0)}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold tracking-wide text-foreground">Weekly Summary</p>
                      <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {monthLabel}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {weeklySummary.map((item) => {
                        const hasTrades = item.count > 0
                        const pnlPositive = item.pnl >= 0

                        return (
                          <div key={item.week} className="rounded-md border border-border/80 bg-card/50 p-2">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-foreground">{item.week}</p>
                              <span className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                                {item.range}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className={cn(
                                "rounded-md px-2 py-0.5 text-[10px] font-medium",
                                hasTrades ? "border border-primary/30 bg-primary/10 text-primary" : "border border-border bg-muted text-muted-foreground",
                              )}>
                                {hasTrades ? `${item.count} trade${item.count > 1 ? "s" : ""}` : "No trades"}
                              </span>

                              <span className={cn(
                                "text-xs font-semibold",
                                hasTrades ? (pnlPositive ? "text-emerald-400" : "text-red-400") : "text-muted-foreground",
                              )}>
                                {hasTrades ? `${pnlPositive ? "+" : ""}${fmtUsd(item.pnl)}` : "-"}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Trades + Performance tabs */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  {(["open", "closed", "performance"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setHistoryTab(tab)}
                      className={cn(
                        "rounded-md px-3 py-1.5 capitalize transition-colors",
                        historyTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab === "open"
                        ? `Open Trades (${openTrades.length})`
                        : tab === "closed"
                        ? `Closed (${totalTrades})`
                        : "Performance"}
                    </button>
                  ))}
                  {(openLoading || closedLoading || perfLoading) && <Spinner />}
                  {historyTab === "open" && !publicView && (
                    <button
                      type="button"
                      onClick={runForceExitAll}
                      disabled={forceExitAllLoading || openLoading || openTrades.length === 0}
                      className="ml-auto flex items-center gap-1 rounded-md border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 transition-colors hover:border-red-300/40 disabled:cursor-not-allowed disabled:opacity-60"
                      title={openTrades.length === 0 ? "No open trades to exit" : "Force exit all open trades"}
                    >
                      {forceExitAllLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                      Force Exit All
                    </button>
                  )}
                </div>

                {historyTab === "open" && (
                  openTrades.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="min-w-[150px] pb-2 pr-4">ID</th>
                            <th className="pb-2 pr-4">Pair</th>
                            <th className="pb-2 pr-4">Amount</th>
                            <th className="pb-2 pr-4">Stake amount ({displayCurrency})</th>
                            <th className="pb-2 pr-4">Open rate</th>
                            <th className="pb-2 pr-4">Current rate</th>
                            <th className="min-w-[150px] pb-2 pr-4">Current profit %</th>
                            <th className="pb-2 pr-4">Open date</th>
                            <th className="pb-2 pr-4">Order Duration</th>
                            {!publicView && <th className="pb-2 text-center">Actions</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {openTrades.map((t) => (
                            <TradeRow
                              key={t.trade_id}
                              t={t}
                              open={true}
                              onOpenAction={runOpenTradeAction}
                              actionLoadingId={actionLoadingId}
                              onSelectTrade={(trade, isOpen) => setActiveTrade({ trade, isOpen })}
                              showActions={!publicView}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid h-24 place-items-center text-center text-sm text-muted-foreground">
                      <div><Clock3 className="mx-auto h-5 w-5 mb-1 opacity-50" />No open trades</div>
                    </div>
                  )
                )}

                {historyTab === "closed" && (
                  sortedClosedTrades.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="min-w-[150px] pb-2 pr-4">ID</th>
                            <th className="pb-2 pr-4">Pair</th>
                            <th className="pb-2 pr-4">Amount</th>
                            <th className="pb-2 pr-4">Total stake amount ({displayCurrency})</th>
                            <th className="pb-2 pr-4">Open rate</th>
                            <th className="pb-2 pr-4">Close rate</th>
                            <th className="min-w-[150px] pb-2 pr-4">Profit %</th>
                            <th className="pb-2 pr-4">Open date</th>
                            <th className="pb-2 pr-4">Close date</th>
                            <th className="pb-2 pr-4">Order Duration</th>
                            <th className="pb-2">Close Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedClosedTrades.map((t) => (
                            <TradeRow
                              key={t.trade_id}
                              t={t}
                              open={false}
                              onSelectTrade={(trade, isOpen) => setActiveTrade({ trade, isOpen })}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid h-24 place-items-center text-center text-sm text-muted-foreground">
                      <div><LineChart className="mx-auto h-5 w-5 mb-1 opacity-50" />No closed trades</div>
                    </div>
                  )
                )}

                {historyTab === "performance" && (
                  perfRows.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="pb-2 pr-4">Pair</th>
                            <th className="pb-2 pr-4">Profit %</th>
                            <th className="pb-2 pr-4">Profit ({displayCurrency})</th>
                            <th className="pb-2">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perfRows.slice(0, 20).map((r) => <PerfRow key={r.pair} row={r} />)}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid h-24 place-items-center text-center text-sm text-muted-foreground">
                      <div><BarChart3 className="mx-auto h-5 w-5 mb-1 opacity-50" />No performance data</div>
                    </div>
                  )
                )}
              </div>
                </>
              ) : (
                <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-5">
                  <h3 className="text-sm font-semibold text-blue-200">Bot setup in progress</h3>
                  <p className="mt-1 text-xs text-blue-100/80">All bot data will be visible after setup is completed.</p>
                </div>
              )}

              {!publicView && exchangePanelOpen && (
                <div data-name="exchange-sidepanel-overlay" className="fixed inset-0 z-50 bg-black/50">
                  <div data-name="exchange-sidepanel" className="absolute inset-y-0 right-0 w-full max-w-[420px] overflow-y-auto border-l border-border bg-card p-5 text-foreground shadow-[0_20px_80px_rgba(0,0,0,0.55)]">
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setExchangePanelOpen(false)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                        <ChevronLeft className="h-4 w-4" />
                        Back
                      </button>
                      <button type="button" onClick={() => setExchangePanelOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close exchange panel">
                        <XCircle className="h-5 w-5" />
                      </button>
                    </div>

                    <h3 className="mt-6 text-[36px] font-semibold leading-none tracking-tight text-foreground" style={{ fontSize: "38px" }}>
                      Connect <span className="text-primary">{botExchange}</span>
                    </h3>

                    <div className="mt-6 rounded-lg border border-border bg-muted/20 p-4">
                      <p className="text-sm font-semibold text-foreground">Connect key securely <span className="text-primary">Full guide</span></p>
                      <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                        <li>1. Log in to your exchange account and go to API Settings.</li>
                        <li>2. Turn on IP whitelisting and copy/paste the following list of IP addresses:</li>
                      </ol>
                      <div className="mt-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
                        <span className="truncate text-sm font-semibold text-foreground">{exchangeWhitelistIps}</span>
                        <button
                          type="button"
                          onClick={handleCopyExchangeIps}
                          className="ml-auto text-muted-foreground hover:text-foreground"
                          aria-label="Copy IP whitelist"
                        >
                          {exchangeIpsCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="mt-3 text-sm text-muted-foreground">3. Paste generated data in inputs below.</p>
                    </div>

                    <div className="mt-5 space-y-3">
                      <Input
                        value={exchangeAccountName}
                        onChange={(event) => setExchangeAccountName(event.target.value)}
                        placeholder="Account Name"
                        className="h-10 border-border bg-background text-foreground placeholder:text-muted-foreground"
                      />
                      <Input
                        value={exchangeApiKeyInput}
                        onChange={(event) => setExchangeApiKeyInput(event.target.value)}
                        placeholder="API"
                        className="h-10 border-border bg-background text-foreground placeholder:text-muted-foreground"
                      />
                      <Input
                        value={exchangeApiSecretInput}
                        onChange={(event) => setExchangeApiSecretInput(event.target.value)}
                        placeholder="API Secret"
                        type="password"
                        className="h-10 border-border bg-background text-foreground placeholder:text-muted-foreground"
                      />
                    </div>

                    <button
                      type="button"
                      className="mt-6 h-12 w-full rounded-md bg-[#4a67ff] text-lg font-semibold text-white hover:bg-[#5771ff] disabled:opacity-50"
                      onClick={handleConnectExchange}
                      disabled={exchangeConnectLoading}
                    >
                      {exchangeConnectLoading ? "Connecting..." : "Connect"}
                    </button>

                    <p className="mt-4 text-center text-sm text-muted-foreground">
                      Don&apos;t have a {botExchange} account? <span className="text-primary">Sign up now</span>
                    </p>
                  </div>
                </div>
              )}

              {!publicView && settingsPanelOpen && (
                <div data-name="settings-sidepanel-overlay" className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
                  <div data-name="settings-sidepanel" className="absolute inset-y-0 right-0 w-full max-w-[560px] overflow-y-auto border-l border-border/70 bg-gradient-to-b from-background via-card to-background p-6 text-foreground shadow-2xl">
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setSettingsPanelOpen(false)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                        <ChevronLeft className="h-4 w-4" />
                        Back
                      </button>
                      <button type="button" onClick={() => setSettingsPanelOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close settings panel">
                        <XCircle className="h-5 w-5" />
                      </button>
                    </div>

                    <h3 className="mt-6 text-[34px] font-semibold leading-none tracking-tight text-foreground">
                      Bot <span className="text-primary">Settings</span>
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Configure strategy settings. Save applies config/strategy and restarts the bot.
                    </p>

                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs text-muted-foreground">Trade Type</label>
                        <div className="grid grid-cols-2 gap-3">
                          {(["fixed", "compound"] as const).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setSettingsForm((prev) => ({ ...prev, tradeType: opt }))}
                              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                                settingsForm.tradeType === opt
                                  ? "border-primary bg-primary/10"
                                  : "border-border/70 bg-background/60 hover:border-primary/40"
                              }`}
                            >
                              <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${settingsForm.tradeType === opt ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                {settingsForm.tradeType === opt && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                              </span>
                              <span className="text-sm font-medium capitalize text-foreground">{opt.charAt(0).toUpperCase() + opt.slice(1)}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs text-muted-foreground">DCA Mode</label>
                        <div className="grid grid-cols-2 gap-3">
                          {(["Enable", "Disable"] as const).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setSettingsForm((prev) => ({ ...prev, dcaMode: opt }))}
                              className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                                settingsForm.dcaMode === opt
                                  ? "border-primary bg-primary/10"
                                  : "border-border/70 bg-background/60 hover:border-primary/40"
                              }`}
                            >
                              <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${settingsForm.dcaMode === opt ? "border-primary bg-primary" : "border-muted-foreground"}`}>
                                {settingsForm.dcaMode === opt && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                              </span>
                              <span className="text-sm font-medium text-foreground">{opt}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {settingsForm.tradeType === "fixed" && (
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">Stake Amount</label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={settingsForm.stakeAmount}
                            onChange={(event) => setSettingsForm((prev) => ({ ...prev, stakeAmount: Number(event.target.value || 0) }))}
                          />
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Max Open Order</label>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          step="1"
                          value={settingsForm.maxOpenOrder}
                          onChange={(event) => setSettingsForm((prev) => ({ ...prev, maxOpenOrder: Math.max(1, Math.min(100, Math.trunc(Number(event.target.value || 1)))) }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">Stoploss % (1 to 100)</label>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          step="1"
                          value={settingsForm.stoplossPct}
                          onChange={(event) => setSettingsForm((prev) => ({ ...prev, stoplossPct: Math.max(1, Math.min(100, Number(event.target.value || 99))) }))}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">DCA Stoploss % (1 to 100)</label>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          step="1"
                          value={settingsForm.dcaStoplossPct}
                          onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaStoplossPct: Math.max(1, Math.min(100, Number(event.target.value || 50))) }))}
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <label className="text-xs text-muted-foreground">Leverage</label>
                        <Input
                          type="number"
                          min={1}
                          max={125}
                          step="0.1"
                          value={settingsForm.leverage}
                          onChange={(event) => setSettingsForm((prev) => ({ ...prev, leverage: Math.max(1, Math.min(125, Number(event.target.value || 1))) }))}
                        />
                      </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-border/70 bg-background/40 p-3">
                      <p className="mb-3 text-xs font-medium text-foreground">Entry Timeframes</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                          <span>30m</span>
                          <Switch
                            checked={settingsForm.entry30mEnabled}
                            onCheckedChange={(checked) => setSettingsForm((prev) => ({ ...prev, entry30mEnabled: checked }))}
                          />
                        </label>
                        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                          <span>1h</span>
                          <Switch
                            checked={settingsForm.entry1hEnabled}
                            onCheckedChange={(checked) => setSettingsForm((prev) => ({ ...prev, entry1hEnabled: checked }))}
                          />
                        </label>
                        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                          <span>4h</span>
                          <Switch
                            checked={settingsForm.entry4hEnabled}
                            onCheckedChange={(checked) => setSettingsForm((prev) => ({ ...prev, entry4hEnabled: checked }))}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-border/70 bg-background/40 p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-medium text-foreground">24h Change Filter</p>
                        <Switch
                          checked={settingsForm.useChgFilter}
                          onCheckedChange={(checked) => setSettingsForm((prev) => ({ ...prev, useChgFilter: checked }))}
                        />
                      </div>

                      {settingsForm.entry30mEnabled && (
                        <div className="mb-4 rounded-lg border border-border p-3">
                          <p className="mb-2 text-xs font-semibold text-foreground">30m</p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><span>Enable per timeframe</span><Switch checked={settingsForm.chg30mEnabled} onCheckedChange={(checked) => setSettingsForm((prev) => ({ ...prev, chg30mEnabled: checked }))} /></label>
                            <div className="grid grid-cols-2 items-center gap-2 text-xs"><span className="col-span-2 text-muted-foreground">Entry change bounds (min / max) %</span><Input type="number" step="0.1" value={settingsForm.chg30mMin} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg30mMin: Number(event.target.value || 0) }))} /><Input type="number" step="0.1" value={settingsForm.chg30mMax} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg30mMax: Number(event.target.value || 0) }))} /></div>
                            <div className="grid grid-cols-2 items-center gap-2 text-xs"><span className="col-span-2 text-muted-foreground">DCA change bounds (min / max) %</span><Input type="number" step="0.1" value={settingsForm.dcaChg30mMin} onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaChg30mMin: Number(event.target.value || 0) }))} /><Input type="number" step="0.1" value={settingsForm.dcaChg30mMax} onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaChg30mMax: Number(event.target.value || 0) }))} /></div>
                            <div className="space-y-1 text-xs"><span className="text-muted-foreground">Exit buffer per timeframe</span><Input type="number" step="0.1" value={settingsForm.chg30mExitBuffer} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg30mExitBuffer: Number(event.target.value || 0) }))} /></div>
                          </div>
                        </div>
                      )}

                      {settingsForm.entry1hEnabled && (
                        <div className="mb-4 rounded-lg border border-border p-3">
                          <p className="mb-2 text-xs font-semibold text-foreground">1h</p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><span>Enable per timeframe</span><Switch checked={settingsForm.chg1hEnabled} onCheckedChange={(checked) => setSettingsForm((prev) => ({ ...prev, chg1hEnabled: checked }))} /></label>
                            <div className="grid grid-cols-2 items-center gap-2 text-xs"><span className="col-span-2 text-muted-foreground">Entry change bounds (min / max) %</span><Input type="number" step="0.1" value={settingsForm.chg1hMin} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg1hMin: Number(event.target.value || 0) }))} /><Input type="number" step="0.1" value={settingsForm.chg1hMax} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg1hMax: Number(event.target.value || 0) }))} /></div>
                            <div className="grid grid-cols-2 items-center gap-2 text-xs"><span className="col-span-2 text-muted-foreground">DCA change bounds (min / max) %</span><Input type="number" step="0.1" value={settingsForm.dcaChg1hMin} onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaChg1hMin: Number(event.target.value || 0) }))} /><Input type="number" step="0.1" value={settingsForm.dcaChg1hMax} onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaChg1hMax: Number(event.target.value || 0) }))} /></div>
                            <div className="space-y-1 text-xs"><span className="text-muted-foreground">Exit buffer per timeframe</span><Input type="number" step="0.1" value={settingsForm.chg1hExitBuffer} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg1hExitBuffer: Number(event.target.value || 0) }))} /></div>
                          </div>
                        </div>
                      )}

                      {settingsForm.entry4hEnabled && (
                        <div className="rounded-lg border border-border p-3">
                          <p className="mb-2 text-xs font-semibold text-foreground">4h</p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"><span>Enable per timeframe</span><Switch checked={settingsForm.chg4hEnabled} onCheckedChange={(checked) => setSettingsForm((prev) => ({ ...prev, chg4hEnabled: checked }))} /></label>
                            <div className="grid grid-cols-2 items-center gap-2 text-xs"><span className="col-span-2 text-muted-foreground">Entry change bounds (min / max) %</span><Input type="number" step="0.1" value={settingsForm.chg4hMin} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg4hMin: Number(event.target.value || 0) }))} /><Input type="number" step="0.1" value={settingsForm.chg4hMax} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg4hMax: Number(event.target.value || 0) }))} /></div>
                            <div className="grid grid-cols-2 items-center gap-2 text-xs"><span className="col-span-2 text-muted-foreground">DCA change bounds (min / max) %</span><Input type="number" step="0.1" value={settingsForm.dcaChg4hMin} onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaChg4hMin: Number(event.target.value || 0) }))} /><Input type="number" step="0.1" value={settingsForm.dcaChg4hMax} onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaChg4hMax: Number(event.target.value || 0) }))} /></div>
                            <div className="space-y-1 text-xs"><span className="text-muted-foreground">Exit buffer per timeframe</span><Input type="number" step="0.1" value={settingsForm.chg4hExitBuffer} onChange={(event) => setSettingsForm((prev) => ({ ...prev, chg4hExitBuffer: Number(event.target.value || 0) }))} /></div>
                          </div>
                        </div>
                      )}

                      {!settingsForm.entry30mEnabled && !settingsForm.entry1hEnabled && !settingsForm.entry4hEnabled && (
                        <p className="text-xs text-muted-foreground">Enable at least one Entry Timeframe to configure change-filter values.</p>
                      )}

                      <p className="mt-4 mb-2 text-[11px] text-muted-foreground">DCA re-entry window (%)</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">Min Profit %</label>
                          <Input type="number" step="0.01" value={settingsForm.dcaReentryMinProfit} onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaReentryMinProfit: Number(event.target.value || 0) }))} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-muted-foreground">Max Drawdown %</label>
                          <Input type="number" step="0.01" value={settingsForm.dcaReentryMaxDrawdown} onChange={(event) => setSettingsForm((prev) => ({ ...prev, dcaReentryMaxDrawdown: Number(event.target.value || 0) }))} />
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex gap-2">
                      <Button variant="outline" className="h-10 flex-1" onClick={() => setSettingsPanelOpen(false)} disabled={settingsSaving}>
                        Cancel
                      </Button>
                      <Button className="h-10 flex-1 shadow-lg shadow-primary/20" onClick={handleSaveBotSettings} disabled={settingsSaving}>
                        {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
                        {settingsSaving ? "Applying..." : "Save & Apply"}
                      </Button>
                    </div>

                    {!!setupError && (
                      <p className="mt-3 text-xs text-red-400">{setupError}</p>
                    )}
                    {!!setupMessage && !setupError && (
                      <p className="mt-3 text-xs text-emerald-400">{setupMessage}</p>
                    )}
                  </div>
                </div>
              )}

              {!publicView && <Dialog
                open={shareDialogOpen}
                onOpenChange={(open) => {

                    {exchangeConnectLoading && (
                      <div className="mt-4 rounded-lg border border-primary/25 bg-primary/10 p-3">
                        <div className="flex items-center gap-2 text-sm text-foreground">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span>
                            {exchangeConnectStage === "validating"
                              ? `Validating ${botExchange} API...`
                              : "Switching bot from dry run to live..."}
                          </span>
                        </div>
                      </div>
                    )}
                  setShareDialogOpen(open)
                  if (!open) setShareCopied(false)
                }}
              >
                <DialogContent className="max-w-[500px] border-border bg-[#071633] p-0 text-white">
                  <DialogHeader className="border-b border-white/10 px-6 py-5 text-left">
                    <DialogTitle className="text-3xl font-semibold tracking-tight text-white">Share Dashboard</DialogTitle>
                    <DialogDescription className="pt-1 text-sm text-slate-400">
                      {displayBotId}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6 px-6 py-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-lg font-semibold text-white">Enable sharing</p>
                      </div>
                      <Switch
                        checked={shareEnabled}
                        onCheckedChange={updateShareEnabled}
                        disabled={shareLoading}
                      />
                    </div>

                    <div className="space-y-3">
                      <p className="text-lg font-semibold text-white">Share Link</p>
                      <div className="flex items-center gap-3">
                        <Input
                          value={shareLoading ? "Loading share link..." : shareEnabled ? shareLink : "Sharing disabled"}
                          readOnly
                          className="h-12 rounded-xl border border-white/10 bg-white/5 px-4 text-base text-slate-300 placeholder:text-slate-500"
                        />
                        <button
                          type="button"
                          onClick={handleCopyShareLink}
                          disabled={shareLoading || !shareEnabled || !shareLink}
                          className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Copy share link"
                        >
                          {shareCopied ? <Check className="h-5 w-5 text-emerald-300" /> : <Copy className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/10 px-6 py-7 text-center text-base leading-7 text-slate-400">
                      Share links allow others to view your trading dashboard and performance metrics.
                    </div>
                  </div>
                </DialogContent>
              </Dialog>}

              {!publicView && <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent className="max-w-md border-border bg-card">
                  <DialogHeader>
                    <DialogTitle>Delete Bot</DialogTitle>
                    <DialogDescription>
                      This will permanently delete this bot and its setup data. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    Bot: {displayBotId}
                  </div>

                  <div className="mt-2 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleteLoading}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteBot}
                      disabled={deleteLoading}
                    >
                      {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {deleteLoading ? "Deleting..." : "Delete Bot"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>}

              {!publicView && <Dialog open={switchToDryRunDialogOpen} onOpenChange={setSwitchToDryRunDialogOpen}>
                <DialogContent className="max-w-md border-border bg-card">
                  <DialogHeader>
                    <DialogTitle>Switch Live To Dry Run</DialogTitle>
                    <DialogDescription>
                      This will switch your bot from live mode to dry run mode.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    Bot: {displayBotId}
                  </div>

                  <div className="mt-2 flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setSwitchToDryRunDialogOpen(false)} disabled={switchToDryRunLoading}>
                      Cancel
                    </Button>
                    <Button onClick={handleSwitchToDryRun} disabled={switchToDryRunLoading}>
                      {switchToDryRunLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {switchToDryRunLoading ? "Switching..." : "Switch To Dry Run"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>}



              <Dialog
                open={!!activeTrade}
                onOpenChange={(open) => {
                  if (!open) {
                    setActiveTrade(null)
                    setActiveTradeDetail(null)
                    setActiveTradeDetailLoading(false)
                  }
                }}
              >
                <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto pb-6">
                  <DialogHeader>
                    <DialogTitle>Order Details</DialogTitle>
                    <DialogDescription>
                      Trade #{activeTrade?.trade.trade_id} • {activeTrade?.isOpen ? "Open order" : "Closed order"}
                    </DialogDescription>
                  </DialogHeader>

                  {activeTrade && (
                    (() => {
                      const detail = (activeTradeDetail ?? activeTrade.trade) as FtTradeDetail
                      const entryTag = detail.entry_tag ?? detail.enter_tag ?? `${detail.is_short ? "Short" : "Long"}`
                      const stakeLabel = `${fmtUsd(detail.stake_amount ?? 0)}${typeof detail.leverage === "number" && Number.isFinite(detail.leverage) ? ` (${fmt(detail.leverage, 0)}x)` : ""}`
                      const rawPct = typeof detail.close_profit_pct === "number" ? detail.close_profit_pct : (detail.profit_pct ?? 0)
                      const normalizedRawPct = Math.abs(rawPct) <= 1 ? rawPct * 100 : rawPct
                      const computedPct = typeof detail.stake_amount === "number" && detail.stake_amount !== 0
                        ? ((detail.close_profit_abs ?? detail.profit_abs ?? 0) / detail.stake_amount) * 100
                        : null
                      const closePct = computedPct ?? normalizedRawPct
                      const closeAbs = detail.close_profit_abs ?? detail.profit_abs ?? 0
                      const orders = Array.isArray(detail.orders) ? detail.orders : []
                      const successfulEntries = detail.nr_of_successful_entries ?? activeTrade.trade.nr_of_successful_entries ?? 1
                      const isDcaTrade = successfulEntries > 1
                      const orderDuration = activeTrade.isOpen
                        ? (detail.trade_duration ?? fmtDurationBetween(detail.open_date ?? activeTrade.trade.open_date, new Date().toISOString()))
                        : fmtDurationBetween(detail.open_date ?? activeTrade.trade.open_date, detail.close_date)
                      const rawStopPct = detail.stop_loss_pct
                      const normalizedStopPct =
                        typeof rawStopPct === "number"
                          ? (Math.abs(rawStopPct) <= 1 ? Math.abs(rawStopPct) * 100 : Math.abs(rawStopPct))
                          : null
                      const atRiskValue =
                        typeof detail.stake_amount === "number" && normalizedStopPct !== null
                          ? detail.stake_amount * (normalizedStopPct / 100)
                          : null

                      return (
                        <div className="space-y-4 text-sm">
                          {activeTradeDetailLoading ? (
                            <OrderDetailsSkeleton />
                          ) : (
                            <>
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
                              <p className="border-b border-border pb-1 text-base font-semibold">General</p>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Trade Id</span><span className="font-medium">{detail.trade_id ?? activeTrade.trade.trade_id}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Pair</span><span className="font-medium">{fmtPair(detail.pair ?? activeTrade.trade.pair)}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Open date</span><span className="font-medium">{fmtDateTime(detail.open_date ?? activeTrade.trade.open_date)}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Entry tag</span><span className="font-medium">{entryTag}{isDcaTrade && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">DCA</span>}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Total Stake</span><span className="font-medium">{stakeLabel}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Amount</span><span className="font-medium">{typeof detail.amount === "number" ? detail.amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 }) : "-"}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Open Rate</span><span className="font-medium">{typeof detail.open_rate === "number" ? detail.open_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Close Rate</span><span className="font-medium">{typeof detail.close_rate === "number" ? detail.close_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Close date</span><span className="font-medium">{fmtDateTime(detail.close_date)}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Order Duration</span><span className="rounded bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{orderDuration || "-"}</span></div>
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Close Profit</span><span className={cn("font-semibold", closeAbs >= 0 ? "text-emerald-400" : "text-red-400")}>{`${closePct >= 0 ? "+" : ""}${closePct.toFixed(2)}% (${fmtUsd(closeAbs)})`}</span></div>
                            </div>

                            <div className="space-y-4">
                              <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
                                <p className="border-b border-border pb-1 text-base font-semibold">Details</p>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Min Rate</span><span className="font-medium">{typeof detail.min_rate === "number" ? detail.min_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Max Rate</span><span className="font-medium">{typeof detail.max_rate === "number" ? detail.max_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Open-Fees</span><span className="font-medium">{typeof detail.fee_open_cost === "number" ? `${fmtUsd(detail.fee_open_cost)} (${fmtPctNumber(detail.fee_open, 3)})` : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Fees close</span><span className="font-medium">{typeof detail.fee_close_cost === "number" ? `${fmtUsd(detail.fee_close_cost)} (${fmtPctNumber(detail.fee_close, 3)})` : "-"}</span></div>
                              </div>

                              <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
                                <p className="border-b border-border pb-1 text-base font-semibold">Stoploss</p>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Stoploss</span><span className="font-medium">{typeof detail.stop_loss_pct === "number" || typeof detail.stop_loss_abs === "number" ? `${fmtPctNumber(detail.stop_loss_pct, 3)} | ${typeof detail.stop_loss_abs === "number" ? fmt(detail.stop_loss_abs, 5) : "-"}` : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">At risk</span><span className="font-medium">{typeof atRiskValue === "number" ? fmtUsd(atRiskValue) : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Initial Stoploss</span><span className="font-medium">{typeof detail.initial_stop_loss_pct === "number" || typeof detail.initial_stop_loss_abs === "number" ? `${fmtPctNumber(detail.initial_stop_loss_pct, 3)} | ${typeof detail.initial_stop_loss_abs === "number" ? fmt(detail.initial_stop_loss_abs, 5) : "-"}` : "-"}</span></div>
                              </div>

                              <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
                                <p className="border-b border-border pb-1 text-base font-semibold">Futures/Margin</p>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Direction</span><span className="font-medium">{detail.is_short ? "short" : "long"}{typeof detail.leverage === "number" ? ` - ${fmt(detail.leverage, 0)}x` : ""}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Funding fees</span><span className="font-medium">{typeof detail.funding_fees === "number" ? fmt(detail.funding_fees, 12) : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Interest rate</span><span className="font-medium">{typeof detail.interest_rate === "number" ? fmt(detail.interest_rate, 6) : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Liquidation Price</span><span className="font-medium">{typeof detail.liquidation_price === "number" ? fmt(detail.liquidation_price, 5) : "-"}</span></div>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2 rounded-md border border-border bg-black/40 p-3">
                            <div className="flex items-center justify-between border-b border-border pb-1">
                              <p className="text-base font-semibold text-foreground">Orders [{orders.length}]</p>
                              <div className="flex items-center gap-2"><span className="text-muted-foreground">Close Reason</span><span className="font-medium text-foreground">{getCloseReason(detail)}</span></div>
                            </div>
                            {orders.length > 0 ? (
                              <div className="space-y-1 font-mono text-xs leading-6 text-foreground">
                                {orders.map((order, idx) => {
                                  const side = (order.side ?? order.ft_order_side ?? "-").toLowerCase()
                                  const isBuy = side === "buy"
                                  const rate = typeof order.rate === "number"
                                    ? fmt(order.rate, 5)
                                    : typeof order.price === "number"
                                    ? fmt(order.price, 5)
                                    : typeof order.safe_price === "number"
                                    ? fmt(order.safe_price, 5)
                                    : "-"
                                  const amount = typeof order.amount === "number" ? fmt(order.amount, 3) : typeof order.filled === "number" ? fmt(order.filled, 3) : "-"
                                  const reason = order.reason ?? order.order_tag ?? order.ft_order_tag ?? "-"
                                  const orderTime = order.order_date_utc ?? order.order_date ?? order.order_filled_timestamp ?? order.order_timestamp

                                  return (
                                    <div key={order.order_id ?? idx} className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-semibold text-zinc-100">(#{idx + 1})</span>
                                      <span className="text-zinc-100">{fmtUtcDateTime(orderTime)} (UTC)</span>
                                      <span className={cn("font-semibold", isBuy ? "text-emerald-400" : "text-red-400")}>{side}</span>
                                      <span className="text-zinc-100">for</span>
                                      <span className="font-semibold text-zinc-100">{rate}</span>
                                      <span className="text-zinc-400">|</span>
                                      <span className="text-zinc-100">{amount}</span>
                                      <span className="text-zinc-400">|</span>
                                      <span className="text-zinc-100">{reason}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">No order execution details returned by API.</p>
                            )}
                          </div>
                            </>
                          )}
                        </div>
                      )
                    })()
                  )}
                </DialogContent>
              </Dialog>

              {/* Disclaimer */}
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Trading Results Disclaimer</p>
                <p className="mt-1">
                  Data is sourced live from the connected trading service. Past performance does not guarantee future results.
                  If data appears delayed, use the Refresh button above or check the bot connection.
                </p>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-[420px] rounded-lg border border-border bg-card p-8 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <Wallet className="h-9 w-9 text-muted-foreground" />
              </div>
              <h2 className="mt-6 text-2xl font-semibold text-foreground">Select a Bot to View Details</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Choose a bot from the list to inspect allocation and performance metrics.
              </p>
              <div className="mt-6 rounded-lg border border-border bg-background p-4">
                <p className="text-sm text-muted-foreground">Don&apos;t have a bot yet?</p>
                <p className="mt-1 text-sm text-muted-foreground">Create a bot and aim for an average 20% monthly return.</p>
                <Button asChild className="mt-4 h-11 w-full rounded-xl bg-[#4a67ff] text-white hover:bg-[#5874ff]">
                  <Link href="/new-bot">
                    <Rocket className="h-4 w-4" />
                    Buy Bot
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}