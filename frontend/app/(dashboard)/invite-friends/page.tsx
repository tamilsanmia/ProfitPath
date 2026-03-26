import { InviteFriendsInterface } from "@/components/invite-friends-interface";

export const metadata = {
  title: "Invite Friends | BotPrimeX",
  description: "Invite your friends to BotPrimeX and earn rewards",
};

export default function InviteFriendsPage() {
  return (
    <section data-name="page-dashboard-invite-friends">
      <InviteFriendsInterface />
    </section>
  );
}
