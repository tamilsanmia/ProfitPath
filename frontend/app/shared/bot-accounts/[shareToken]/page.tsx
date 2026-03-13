import { MyBotsPage } from "@/components/my-bots"

export const metadata = {
  title: "Shared Bot Dashboard | DefibotX",
  description: "View shared bot performance and details.",
}

export default async function SharedBotAccountPage({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params

  return <MyBotsPage initialBotId={decodeURIComponent(shareToken)} publicView />
}
