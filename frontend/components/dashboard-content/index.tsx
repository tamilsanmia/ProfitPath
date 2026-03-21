"use client";

import { useEffect, useMemo, useState } from "react";
import { KpiCards } from "./components/kpi-cards";
import { ProfitChart } from "./components/profit-chart";
import { RecentTrades } from "./components/recent-trades";
import { TopBots } from "./components/top-bots";
import { WalletOverview } from "./components/wallet-overview";
import { useCurrencyRealtime } from "@/hooks/use-currency-realtime";
import { kpiCardsData, profitData, recentTradesData, topBotsData, walletAssetsData } from "./data";
import { useDashboard } from "./hooks/use-dashboard";

type BackendUser = {
  id: number;
  email: string;
};

type BackendHealth = {
  status?: string;
  postgres?: string;
  redis?: string;
};

export function DashboardContent() {
  useCurrencyRealtime();

  const { profitTimeframe, handleTimeframeChange } = useDashboard();
  const [usersCount, setUsersCount] = useState<number | null>(null);
  const [health, setHealth] = useState<BackendHealth | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadBackendData() {
      try {
        const [usersResponse, healthResponse] = await Promise.all([
          fetch("/api/users", { cache: "no-store" }),
          fetch("/api/system/health", { cache: "no-store" }),
        ]);

        const usersPayload = await usersResponse.json();
        const healthPayload = await healthResponse.json();

        if (!isMounted) {
          return;
        }

        if (usersResponse.ok && Array.isArray(usersPayload.users)) {
          setUsersCount(usersPayload.users.length);
        }

        if (healthResponse.ok) {
          setHealth(healthPayload);
        }
      } catch {
        if (isMounted) {
          setHealth({ status: "down" });
        }
      }
    }

    loadBackendData();

    return () => {
      isMounted = false;
    };
  }, []);

  const dynamicCards = useMemo(() => {
    const cards = [...kpiCardsData];

    cards[1] = {
      ...cards[1],
      title: "Registered Users",
      value: usersCount === null ? "--" : `${usersCount}`,
      change: usersCount === null ? "Waiting for backend data" : "Live count from PostgreSQL",
      changeType: usersCount === null ? "neutral" : "positive",
    };

    const backendHealthy = health?.status === "ok" && health?.postgres === "ok" && health?.redis === "ok";
    cards[2] = {
      ...cards[2],
      title: "Backend Status",
      value: backendHealthy ? "Online" : "Offline",
      change: backendHealthy ? "Postgres + Redis connected" : "Check backend /health",
      changeType: backendHealthy ? "positive" : "negative",
    };

    return cards;
  }, [health, usersCount]);

  return (
    <div className="flex flex-col gap-4">
      {/* KPI Cards */}
      <KpiCards cards={dynamicCards} />

      {/* Charts Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <ProfitChart profitData={profitData} timeframe={profitTimeframe} onTimeframeChange={handleTimeframeChange} />
        <RecentTrades trades={recentTradesData} />
      </div>

      {/* Bots and Wallet Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <TopBots bots={topBotsData} />
        <WalletOverview assets={walletAssetsData} />
      </div>
    </div>
  );
}
