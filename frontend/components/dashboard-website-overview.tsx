"use client";

import { Rocket, Share2 } from "lucide-react";

export function DashboardWebsiteOverview() {
  return (
    <section data-name="dashboard-website-overview" className="px-6 py-5 text-white lg:px-8 lg:py-6">
      <div data-name="dashboard-overview-header" className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div data-name="dashboard-overview-greeting" className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#10284e] text-2xl font-bold text-white">T</div>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">Hey, TamilSelvan</h1>
        </div>

        <div data-name="dashboard-overview-actions" className="flex items-center gap-3">
          <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-[#4a67ff] px-5 py-2.5 text-lg font-semibold text-white transition-colors hover:bg-[#5771ff]">
            <Rocket className="h-4 w-4" />
            BUY BOT
          </button>

          <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-[#2a3f69] bg-transparent px-5 py-2.5 text-lg font-semibold text-white transition-colors hover:border-[#3c578d]">
            <Share2 className="h-4 w-4" />
            Share
          </button>
        </div>
      </div>
    </section>
  );
}
