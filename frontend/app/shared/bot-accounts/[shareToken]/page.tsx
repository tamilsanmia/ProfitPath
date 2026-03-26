import { MyBotsPage } from "@/components/my-bots"

export const metadata = {
  title: "Shared Bot Dashboard | BotPrimeX",
  description: "View shared bot performance and details.",
}

export default async function SharedBotAccountPage({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params

  return (
    <section data-name="page-shared-bot-account">
      <MyBotsPage initialBotId={decodeURIComponent(shareToken)} publicView />
    </section>
  )
}
