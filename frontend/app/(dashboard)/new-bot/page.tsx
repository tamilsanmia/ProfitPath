import { Suspense } from "react";
import { SubscriptionInterface } from "@/components/subscription-interface/index";

export const metadata = {
  title: "New Bot | BotPrimeX",
  description: "Advanced AI-powered trading bot for cryptocurrency markets",
};

export default function NewBotPage() {
  return (
    <section data-name="page-dashboard-new-bot">
      <Suspense>
        <SubscriptionInterface />
      </Suspense>
    </section>
  );
}
