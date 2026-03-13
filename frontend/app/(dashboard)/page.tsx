export const metadata = {
  title: "Dashboard | DefibotX",
  description: "Advanced AI-powered trading bot for cryptocurrency markets",
};

import { DashboardContent } from "@/components/dashboard-content";
import { Bot, LifeBuoy, ShieldCheck, Wallet } from "lucide-react";

export default function Home() {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-5 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">ProfitPath Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Monitor bots, review portfolio performance, and manage your trading setup from one place.
            </p>
          </div>

          <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            Live workspace overview
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Bot className="h-4 w-4 text-primary" />
              Bot Automation
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Deploy DCA, arbitrage, and signal bots with strategy controls.</p>
          </div>

          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Wallet className="h-4 w-4 text-primary" />
              Asset Tracking
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Track balances, PnL, and allocation across connected wallets.</p>
          </div>

          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Security Controls
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Manage session safety, 2FA, and exchange connection protections.</p>
          </div>

          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <LifeBuoy className="h-4 w-4 text-primary" />
              Help and Support
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Access guidance, templates, and support resources anytime.</p>
          </div>
        </div>
      </section>

      <DashboardContent />
    </div>
  );
}
