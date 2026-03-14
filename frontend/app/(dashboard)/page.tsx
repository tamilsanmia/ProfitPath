export const metadata = {
  title: "Dashboard | DefibotX",
  description: "Advanced AI-powered trading bot for cryptocurrency markets",
};

import { DashboardWebsiteOverview } from "@/components/dashboard-website-overview";

export default function Home() {
  return (
    <section data-name="page-dashboard-home">
      <DashboardWebsiteOverview />
    </section>
  );
}
