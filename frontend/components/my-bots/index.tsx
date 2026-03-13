"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Filter,
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
import type { FtOpenTrade, FtClosedTrade, FtPerformance, FtBotEntry } from "@/hooks/use-bot-data"

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function fmtPct(n: number) { return (n * 100).toFixed(2) + "%" }
function fmtUsd(n: number) { return "$" + fmt(n) }

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
  "h-11 w-full appearance-none rounded-xl border border-border bg-background px-4 pr-10 text-sm text-foreground outline-none"

const FILTER_ALL = "All"

// ─── small sub-components ─────────────────────────────────────────────────────

function Spinner() {
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
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
          {fmt(t.stake_amount, 3)}
          {typeof t.leverage === "number" && Number.isFinite(t.leverage) ? ` (${fmt(t.leverage, 0)}x)` : ""}
        </td>
        <td className="py-2 pr-4 text-muted-foreground">
          {t.open_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
        </td>
        <td className="py-2 pr-4 text-muted-foreground">
          {t.current_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
        </td>
        <td className={cn("min-w-[150px] whitespace-nowrap py-2 pr-4", pnlClass)}>
          {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}% ({fmt(t.profit_abs, 3)})
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
        {"stake_amount" in t ? fmt(t.stake_amount, 3) : "-"}
        {typeof t.leverage === "number" && Number.isFinite(t.leverage) ? ` (${fmt(t.leverage, 0)}x)` : ""}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">
        {"open_rate" in t ? t.open_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}
      </td>
      <td className="py-2 pr-4 text-muted-foreground">
        {"close_rate" in t ? t.close_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}
      </td>
      <td className={cn("min-w-[150px] whitespace-nowrap py-2 pr-4", pnlClass)}>
        {profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}% ({fmt(t.profit_abs, 3)})
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
}: {
  bot: FtBotEntry
  isSelected: boolean
  viewMode: "cards" | "list"
  onSelect: () => void
}) {
  const { data: stats, loading } = useBotStats(bot.id)

  const status = stats?.config?.state ?? (loading ? "Loading" : "Unknown")
  const statusClassName =
    status.toLowerCase() === "running"
      ? "rounded-full border border-emerald-400/20 bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300"
      : "rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
  const balance = stats?.balance_usdt ?? 0
  const exchangeFuture = stats?.config?.exchange ? `${stats.config.exchange} Futures` : "N/A Futures"
  const pnl = stats?.profit?.profit_closed_fiat ?? 0
  const profitPct = stats?.profit?.profit_closed_percent ?? 0
  const pnlClass = pnl >= 0 ? "text-emerald-400" : "text-red-400"

  if (viewMode === "list") {
    return (
      <button
        type="button"
        className={cn(
          "w-full rounded-lg border bg-card px-4 py-4 text-left transition-all hover:border-primary/60",
          isSelected ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]" : "border-border",
        )}
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-foreground">{bot.name}</p>
            <p className="text-xs text-muted-foreground">{bot.id}</p>
          </div>
          <Badge className={statusClassName}>
            {status}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Balance</p>
            <p className="font-semibold text-foreground">{fmtUsd(balance)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Exchange</p>
            <p className="truncate font-semibold text-foreground">{exchangeFuture}</p>
          </div>
          <div>
            <p className="text-muted-foreground">P&L</p>
            <p className={cn("font-semibold", pnlClass)}>{pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Profit %</p>
            <p className={cn("font-semibold", pnlClass)}>{profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%</p>
          </div>
        </div>
      </button>
    )
  }

  return (
    <Card
      className={cn(
        "cursor-pointer rounded-lg border bg-card transition-all hover:border-primary/60",
        isSelected ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]" : "border-border",
      )}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold text-foreground">{bot.name}</p>
            <p className="text-xs text-muted-foreground">{bot.id}</p>
          </div>
          <Badge className={statusClassName}>
            {status}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <div>
            <p className="text-muted-foreground">Balance</p>
            <p className="font-semibold text-foreground">{fmtUsd(balance)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Exchange</p>
            <p className="truncate font-semibold text-foreground">{exchangeFuture}</p>
          </div>
          <div>
            <p className="text-muted-foreground">P&L</p>
            <p className={cn("font-semibold", pnlClass)}>{pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Profit %</p>
            <p className={cn("font-semibold", pnlClass)}>{profitPct >= 0 ? "+" : ""}{profitPct.toFixed(2)}%</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── main export ──────────────────────────────────────────────────────────────

export function MyBotsPage({ initialBotId = null, publicView = false }: { initialBotId?: string | null; publicView?: boolean } = {}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialBotId)
  const [typeFilter, setTypeFilter] = useState(FILTER_ALL)
  const [stateFilter, setStateFilter] = useState(FILTER_ALL)
  const [phaseFilter, setPhaseFilter] = useState(FILTER_ALL)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards")
  const [historyTab, setHistoryTab] = useState<"open" | "closed" | "performance">("open")
  const [chartRange, setChartRange] = useState<"7D" | "1M" | "3M" | "All">("All")
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null)
  const [forceExitAllLoading, setForceExitAllLoading] = useState(false)
  const [botControlLoading, setBotControlLoading] = useState<"pause" | "start" | null>(null)
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
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

  const publicBot = useMemo(() => {
    if (!selectedId) return null
    return {
      id: selectedId,
      name: stats?.bot_name ?? selectedId,
    }
  }, [selectedId, stats?.bot_name])

  const filteredBots = useMemo(() => {
    if (publicView) return publicBot ? [publicBot] : []
    if (typeFilter === FILTER_ALL) return bots
    return bots // Bot list filters are reserved for future metadata.
  }, [bots, publicBot, publicView, typeFilter])

  const bot = publicView ? publicBot : bots.find((b) => b.id === selectedId) ?? null

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

  return (
    <div className="min-h-[calc(100vh-96px)] border border-border bg-background text-foreground rounded-lg">
      <div className={cn("relative grid min-h-[calc(100vh-96px)] grid-cols-1", publicView ? "xl:grid-cols-1" : isPanelCollapsed ? "xl:grid-cols-[72px_minmax(0,1fr)]" : "xl:grid-cols-[360px_minmax(0,1fr)]")}>
        {!publicView && <aside className="border-b border-border p-6 transition-all duration-300 xl:border-b-0 xl:border-r">
          {!isPanelCollapsed ? (
            <>
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
                  T
                </div>
                <div>
                  <h1 className="text-[20px] font-semibold tracking-tight">Hey, TamilSelvan</h1>
                  <p className="text-sm text-muted-foreground">Manage your active bots, drafts, and new purchases.</p>
                </div>
              </div>

              <Button className="mt-6 h-12 w-full rounded-xl bg-[#4a67ff] text-[15px] font-semibold text-white hover:bg-[#5771ff]">
                <Rocket className="h-4 w-4" />
                Buy Bot
              </Button>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <label className="relative">
                  <select
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    className={selectClassName}
                  >
                    {[FILTER_ALL, "Competition", "Two Step Pro", "Instant"].map((option) => (
                      <option key={option} value={option}>
                        {option === FILTER_ALL ? "All Types" : option}
                      </option>
                    ))}
                  </select>
                  <Filter className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </label>

                <label className="relative">
                  <select
                    value={stateFilter}
                    onChange={(event) => setStateFilter(event.target.value)}
                    className={selectClassName}
                  >
                    {[FILTER_ALL, "Running", "Paused", "Completed"].map((option) => (
                      <option key={option} value={option}>
                        {option === FILTER_ALL ? "All States" : option}
                      </option>
                    ))}
                  </select>
                  <SlidersHorizontal className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </label>

                <label className="relative">
                  <select
                    value={phaseFilter}
                    onChange={(event) => setPhaseFilter(event.target.value)}
                    className={selectClassName}
                  >
                    {[FILTER_ALL, "Draft", "Live", "Scaling"].map((option) => (
                      <option key={option} value={option}>
                        {option === FILTER_ALL ? "All Phases" : option}
                      </option>
                    ))}
                  </select>
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </label>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <div className="flex rounded-full border border-border bg-muted p-1">
                  <button
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                      viewMode === "cards" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    type="button"
                    onClick={() => setViewMode("cards")}
                    aria-label="Card view"
                    aria-pressed={viewMode === "cards"}
                  >
                    <Wallet className="h-4 w-4" />
                  </button>
                  <button
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                      viewMode === "list" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                    type="button"
                    onClick={() => setViewMode("list")}
                    aria-label="List view"
                    aria-pressed={viewMode === "list"}
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
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
                      onSelect={() => setSelectedId(b.id)}
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
                className="h-10 w-10 rounded-xl bg-[#4a67ff] text-white hover:bg-[#5771ff]"
                aria-label="Buy bot"
              >
                <Rocket className="h-4 w-4" />
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
          style={{ left: isPanelCollapsed ? 60 : 348 }}
        >
          {isPanelCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>}

        <section className="flex items-center justify-center p-6 lg:p-10">
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
            <div className="w-full max-w-[1200px] space-y-4">
              {/* Breadcrumb + actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  {publicView ? <><span>Shared</span><span>&gt;</span><span>Trading Accounts</span><span>&gt;</span></> : <><span>Home</span><span>&gt;</span><span>Bots</span><span>&gt;</span></>}
                  <span className="font-medium text-foreground">{bot.name}</span>
                </div>
                {!publicView && <div className="flex items-center gap-2">
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
                  <Button variant="outline" className="h-7 rounded-lg border-border px-3 text-xs" onClick={() => setShareDialogOpen(true)}>
                    <Share2 className="h-3 w-3" /> Share
                  </Button>
                </div>}
              </div>

              {/* Bot header */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                      {bot.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">{bot.name}</h2>
                      <p className="text-xs text-muted-foreground">{stats.config.exchange} · {stats.config.stake_currency}</p>
                      <p className="text-xs text-muted-foreground">First trade: {stats.profit.first_trade_date?.slice(0, 10) ?? "—"}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {entriesPaused && (
                      <Badge className="rounded-md border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[11px] text-orange-300">
                        Entries Paused
                      </Badge>
                    )}
                    {!entriesPaused && (
                      <Badge
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[11px]",
                          botState === "running"
                            ? "border border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                            : "border border-border bg-secondary text-secondary-foreground"
                        )}
                      >
                        {stats.config.state}
                      </Badge>
                    )}
                    {stats.config.runmode && stats.config.runmode !== "dry_run" && (
                      <Badge className="rounded-md border border-border bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                        {stats.config.runmode}
                      </Badge>
                    )}
                    {stats.config.dry_run && (
                      <Badge className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-300">Dry Run</Badge>
                    )}
                  </div>
                </div>
              </div>

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
                          tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
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
                          formatter={(value: number, name: string) => {
                            if (name === "profit") return [fmtUsd(value), "Profit"]
                            if (name === "projected") return [fmtUsd(value), "Projected profit (incl. unrealized)"]
                            if (name === "pnl") return [fmtUsd(value), "Order P&L"]
                            return [String(value), name]
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
                        {filteredBalanceChartData.length > 0 ? fmtUsd(filteredBalanceChartData[filteredBalanceChartData.length - 1].profit) : "$0.00"} Profit
                      </span>
                      <span className="rounded-md bg-[#FF5A67] px-2 py-1 text-[11px] font-semibold text-white">
                        {filteredBalanceChartData.length > 0 ? fmtUsd(filteredBalanceChartData[filteredBalanceChartData.length - 1].profit + unrealizedPnl) : "$0.00"} Projected profit (incl. unrealized)
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
                            <th className="pb-2 pr-4">Stake amount</th>
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
                            <th className="pb-2 pr-4">Total stake amount</th>
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
                            <th className="pb-2 pr-4">Profit USDT</th>
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

              {!publicView && <Dialog
                open={shareDialogOpen}
                onOpenChange={(open) => {
                  setShareDialogOpen(open)
                  if (!open) setShareCopied(false)
                }}
              >
                <DialogContent className="max-w-[500px] border-border bg-[#071633] p-0 text-white">
                  <DialogHeader className="border-b border-white/10 px-6 py-5 text-left">
                    <DialogTitle className="text-3xl font-semibold tracking-tight text-white">Share Dashboard</DialogTitle>
                    <DialogDescription className="pt-1 text-sm text-slate-400">
                      #{selectedId ?? "-"}
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
                <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
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
                      const stakeLabel = `${fmt(detail.stake_amount ?? 0, 3)} ${stats.config.stake_currency ?? "USDT"}${typeof detail.leverage === "number" && Number.isFinite(detail.leverage) ? ` (${fmt(detail.leverage, 0)}x)` : ""}`
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
                          {activeTradeDetailLoading && (
                            <div className="rounded-md border border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                              Loading extended trade details...
                            </div>
                          )}

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
                              <div className="flex items-center justify-between"><span className="text-muted-foreground">Close Profit</span><span className={cn("font-semibold", closeAbs >= 0 ? "text-emerald-400" : "text-red-400")}>{`${closePct >= 0 ? "+" : ""}${closePct.toFixed(2)}% (${fmt(closeAbs, 3)})`}</span></div>
                            </div>

                            <div className="space-y-4">
                              <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
                                <p className="border-b border-border pb-1 text-base font-semibold">Details</p>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Min Rate</span><span className="font-medium">{typeof detail.min_rate === "number" ? detail.min_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Max Rate</span><span className="font-medium">{typeof detail.max_rate === "number" ? detail.max_rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }) : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Open-Fees</span><span className="font-medium">{typeof detail.fee_open_cost === "number" ? `${fmt(detail.fee_open_cost, 6)} ${stats.config.stake_currency ?? "USDT"} (${fmtPctNumber(detail.fee_open, 3)})` : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Fees close</span><span className="font-medium">{typeof detail.fee_close_cost === "number" ? `${fmt(detail.fee_close_cost, 6)} ${stats.config.stake_currency ?? "USDT"} (${fmtPctNumber(detail.fee_close, 3)})` : "-"}</span></div>
                              </div>

                              <div className="space-y-2 rounded-md border border-border bg-muted/10 p-3">
                                <p className="border-b border-border pb-1 text-base font-semibold">Stoploss</p>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">Stoploss</span><span className="font-medium">{typeof detail.stop_loss_pct === "number" || typeof detail.stop_loss_abs === "number" ? `${fmtPctNumber(detail.stop_loss_pct, 3)} | ${typeof detail.stop_loss_abs === "number" ? fmt(detail.stop_loss_abs, 5) : "-"}` : "-"}</span></div>
                                <div className="flex items-center justify-between"><span className="text-muted-foreground">At risk</span><span className="font-medium">{typeof atRiskValue === "number" ? `${fmt(atRiskValue, 3)} ${stats.config.stake_currency ?? "USDT"}` : "-"}</span></div>
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
                <p className="mt-1 text-sm text-muted-foreground">Create one and trade up to $300,000 in simulated capital.</p>
                <Button className="mt-4 h-11 w-full rounded-xl bg-[#4a67ff] text-white hover:bg-[#5874ff]">
                  <Rocket className="h-4 w-4" />
                  Buy Bot
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}