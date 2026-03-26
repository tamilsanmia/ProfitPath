import { SubscriptionInterface } from "@/components/subscription-interface/index";

export const metadata = {
  title: "New Bot | DefibotX",
  description: "Advanced AI-powered trading bot for cryptocurrency markets",
};

export default function NewBotPage() {
  return (
    <section data-name="page-dashboard-new-bot">
      <SubscriptionInterface />
    </section>
  );
}
