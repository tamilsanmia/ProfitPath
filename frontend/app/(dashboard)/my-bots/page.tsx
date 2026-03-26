import { MyBotsPage } from "@/components/my-bots"

export const metadata = {
  title: "My Bots | BotPrimeX",
  description: "Manage your purchased bots, performance, and bot account details.",
}

export default function MyBotsRoutePage() {
  return (
    <section data-name="page-dashboard-my-bots">
      <MyBotsPage />
    </section>
  )
}
