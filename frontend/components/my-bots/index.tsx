"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import {
  Bot,
  Filter,
  List,
  Plus,
  Rocket,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wallet,
} from "lucide-react"

type BotPhase = "Draft" | "Live" | "Scaling"
type BotState = "Running" | "Paused" | "Completed"

type BotAccount = {
  id: string
  name: string
  balance: string
  pnl: string
  profitRate: string
  type: string
  market: string
  stage: string
  phase: BotPhase
  state: BotState
  strategy: string
  allocation: string
  winRate: string
  maxDrawdown: string
  updatedAt: string
}

const BOT_ACCOUNTS: BotAccount[] = [
  {
    id: "BOT-10908316",
    name: "Momentum Grid Alpha",
    balance: "$100,000.00",
    pnl: "+$0.00",
    profitRate: "0.0%",
    type: "Competition",
    market: "Binance Futures",
    stage: "Student",
    phase: "Draft",
    state: "Paused",
    strategy: "Grid execution with dynamic spread control for volatile majors.",
    allocation: "32% allocated",
    winRate: "64%",
    maxDrawdown: "2.1%",
    updatedAt: "2 min ago",
  },
  {
    id: "BOT-11737994",
    name: "Scalp Engine Pro",
    balance: "$5,017.49",
    pnl: "+$17.49",
    profitRate: "+0.3%",
    type: "Two Step Pro",
    market: "Bybit Futures",
    stage: "Student",
    phase: "Live",
    state: "Running",
    strategy: "Fast scalp execution with volatility and orderbook confirmation.",
    allocation: "76% allocated",
    winRate: "71%",
    maxDrawdown: "1.4%",
    updatedAt: "just now",
  },
  {
    id: "BOT-11844201",
    name: "DCA Recovery Core",
    balance: "$12,440.12",
    pnl: "+$244.10",
    profitRate: "+2.0%",
    type: "Instant",
    market: "Binance Futures",
    stage: "Advanced",
    phase: "Scaling",
    state: "Running",
    strategy: "Layered DCA entries with adaptive recovery exits and capital throttling.",
    allocation: "61% allocated",
    winRate: "68%",
    maxDrawdown: "3.3%",
    updatedAt: "14 min ago",
  },
]

const FILTER_ALL = "All"

function statusClasses(state: BotState) {
  if (state === "Running") {
    return "bg-emerald-500/12 text-emerald-300 border-emerald-400/20"
  }

  if (state === "Paused") {
    return "bg-amber-500/12 text-amber-200 border-amber-400/20"
  }

  return "bg-slate-500/12 text-slate-200 border-slate-400/20"
}

export function MyBotsPage() {
  const [selectedId, setSelectedId] = useState(BOT_ACCOUNTS[0]?.id ?? "")
  const [typeFilter, setTypeFilter] = useState(FILTER_ALL)
  const [stateFilter, setStateFilter] = useState(FILTER_ALL)
  const [phaseFilter, setPhaseFilter] = useState(FILTER_ALL)

  const filteredBots = useMemo(() => {
    return BOT_ACCOUNTS.filter((bot) => {
      const typeMatch = typeFilter === FILTER_ALL || bot.type === typeFilter
      const stateMatch = stateFilter === FILTER_ALL || bot.state === stateFilter
      const phaseMatch = phaseFilter === FILTER_ALL || bot.phase === phaseFilter
      return typeMatch && stateMatch && phaseMatch
    })
  }, [phaseFilter, stateFilter, typeFilter])

  const selectedBot = filteredBots.find((bot) => bot.id === selectedId) ?? filteredBots[0] ?? null

  const statCards = selectedBot
    ? [
        { label: "Balance", value: selectedBot.balance },
        { label: "PnL", value: selectedBot.pnl },
        { label: "Profit %", value: selectedBot.profitRate },
        { label: "Win Rate", value: selectedBot.winRate },
      ]
    : []

  return (
    <div className="min-h-[calc(100vh-96px)] rounded-[28px] border border-[#1a2542] bg-[radial-gradient(circle_at_top_left,_rgba(76,103,255,0.14),_transparent_28%),linear-gradient(90deg,_#08152f_0%,_#07132b_38%,_#07132b_100%)] text-white">
      <div className="grid min-h-[calc(100vh-96px)] grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-b border-[#15203b] p-6 xl:border-b-0 xl:border-r">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/8 text-lg font-semibold text-white">
              T
            </div>
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight">Hey, TamilSelvan</h1>
              <p className="text-sm text-[#7e91b5]">Manage your active bots, drafts, and new purchases.</p>
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
                className="h-11 w-full appearance-none rounded-xl border border-[#1f2c4b] bg-[#0c1730] px-4 pr-10 text-sm text-[#d7e1f5] outline-none"
              >
                {[FILTER_ALL, "Competition", "Two Step Pro", "Instant"].map((option) => (
                  <option key={option} value={option}>
                    {option === FILTER_ALL ? "All Types" : option}
                  </option>
                ))}
              </select>
              <Filter className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f84ac]" />
            </label>

            <label className="relative">
              <select
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-[#1f2c4b] bg-[#0c1730] px-4 pr-10 text-sm text-[#d7e1f5] outline-none"
              >
                {[FILTER_ALL, "Running", "Paused", "Completed"].map((option) => (
                  <option key={option} value={option}>
                    {option === FILTER_ALL ? "All States" : option}
                  </option>
                ))}
              </select>
              <SlidersHorizontal className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f84ac]" />
            </label>

            <label className="relative">
              <select
                value={phaseFilter}
                onChange={(event) => setPhaseFilter(event.target.value)}
                className="h-11 w-full appearance-none rounded-xl border border-[#1f2c4b] bg-[#0c1730] px-4 pr-10 text-sm text-[#d7e1f5] outline-none"
              >
                {[FILTER_ALL, "Draft", "Live", "Scaling"].map((option) => (
                  <option key={option} value={option}>
                    {option === FILTER_ALL ? "All Phases" : option}
                  </option>
                ))}
              </select>
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6f84ac]" />
            </label>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <div className="flex rounded-full border border-[#1c2745] bg-[#101b35] p-1">
              <button className="flex h-8 w-8 items-center justify-center rounded-full bg-white/6 text-[#a9bad9]" type="button">
                <Wallet className="h-4 w-4" />
              </button>
              <button className="flex h-8 w-8 items-center justify-center rounded-full text-[#6e82ab]" type="button">
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {filteredBots.map((bot) => {
              const isSelected = selectedBot?.id === bot.id

              return (
                <Card
                  key={bot.id}
                  className={cn(
                    "cursor-pointer rounded-2xl border bg-[linear-gradient(180deg,rgba(28,39,66,0.96),rgba(20,31,54,0.98))] transition-all hover:border-[#3f5eff]",
                    isSelected ? "border-[#4b68ff] shadow-[0_0_0_1px_rgba(76,103,255,0.18)]" : "border-[#1a2542]",
                  )}
                  onClick={() => setSelectedId(bot.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-[17px] font-semibold text-white">
                          <Bot className="h-4 w-4 text-[#ff8a3d]" />
                          <span>{bot.id}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#7e91b5]">
                          <span>{bot.balance}</span>
                          <span>&bull;</span>
                          <span>{bot.type}</span>
                          <span>&bull;</span>
                          <span>{bot.stage}</span>
                        </div>
                      </div>
                      <Badge className={cn("rounded-full border px-3 py-1 text-[11px] font-medium", statusClasses(bot.state))}>
                        {bot.state}
                      </Badge>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-[#6f84ac]">PnL</p>
                        <p className="mt-1 font-semibold text-emerald-400">{bot.pnl}</p>
                      </div>
                      <div>
                        <p className="text-[#6f84ac]">Profit %</p>
                        <p className="mt-1 font-semibold text-emerald-400">{bot.profitRate}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}

            {filteredBots.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#233154] bg-[#0c1730] px-5 py-10 text-center text-sm text-[#7e91b5]">
                No bots match the selected filters.
              </div>
            )}
          </div>
        </aside>

        <section className="flex items-center justify-center p-6 lg:p-10">
          {selectedBot ? (
            <div className="w-full max-w-[780px] space-y-6">
              <div className="rounded-[28px] border border-[#1a2542] bg-[linear-gradient(180deg,rgba(16,27,53,0.96),rgba(12,22,44,0.94))] p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/6">
                        <Sparkles className="h-6 w-6 text-[#8ea2ff]" />
                      </div>
                      <div>
                        <p className="text-sm uppercase tracking-[0.28em] text-[#6f84ac]">Bot Details</p>
                        <h2 className="mt-1 text-3xl font-semibold tracking-tight text-white">{selectedBot.name}</h2>
                      </div>
                    </div>
                    <p className="mt-5 max-w-[560px] text-sm leading-7 text-[#8ca0c4]">{selectedBot.strategy}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge className="rounded-full border border-[#29406e] bg-[#101b35] px-3 py-1.5 text-[#dce6ff]">
                      {selectedBot.market}
                    </Badge>
                    <Badge className="rounded-full border border-[#29406e] bg-[#101b35] px-3 py-1.5 text-[#dce6ff]">
                      {selectedBot.phase}
                    </Badge>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {statCards.map((stat) => (
                    <div key={stat.label} className="rounded-2xl border border-[#1d2a49] bg-[#0b1630] px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-[#64779f]">{stat.label}</p>
                      <p className="mt-2 text-xl font-semibold text-white">{stat.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-[#1d2a49] bg-[#0b1630] p-5">
                    <p className="text-sm font-medium text-[#dce6ff]">Execution Summary</p>
                    <div className="mt-4 space-y-3 text-sm text-[#8ca0c4]">
                      <div className="flex items-center justify-between">
                        <span>Stage</span>
                        <span className="text-white">{selectedBot.stage}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Allocation</span>
                        <span className="text-white">{selectedBot.allocation}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Max Drawdown</span>
                        <span className="text-white">{selectedBot.maxDrawdown}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Last update</span>
                        <span className="text-white">{selectedBot.updatedAt}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[#1d2a49] bg-[#0b1630] p-5">
                    <p className="text-sm font-medium text-[#dce6ff]">Quick Actions</p>
                    <div className="mt-4 space-y-3">
                      <Button className="h-11 w-full rounded-xl bg-[#4a67ff] text-white hover:bg-[#5874ff]">
                        <Plus className="h-4 w-4" />
                        Buy Similar Bot
                      </Button>
                      <Button variant="outline" className="h-11 w-full rounded-xl border-[#27385f] bg-transparent text-[#dce6ff] hover:bg-[#12203f] hover:text-white">
                        Duplicate Configuration
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-[420px] rounded-[28px] border border-[#1a2542] bg-[linear-gradient(180deg,rgba(16,27,53,0.96),rgba(12,22,44,0.94))] p-8 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/6">
                <Wallet className="h-9 w-9 text-[#7e91b5]" />
              </div>
              <h2 className="mt-6 text-2xl font-semibold text-white">Select a Bot to View Details</h2>
              <p className="mt-3 text-sm leading-7 text-[#8ca0c4]">
                Choose a bot from the list to inspect its strategy, allocation, and performance metrics.
              </p>
              <div className="mt-6 rounded-2xl border border-[#1d2a49] bg-[#0b1630] p-4">
                <p className="text-sm text-[#8ca0c4]">Don&apos;t have a bot yet?</p>
                <p className="mt-1 text-sm text-[#8ca0c4]">Create one and trade up to $300,000 in simulated capital.</p>
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