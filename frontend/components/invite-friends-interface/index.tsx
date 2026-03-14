"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useReferrals } from "@/components/invite-friends-interface/hooks/use-referrals"
import { ReferralLinkCard } from "./components/referral-link-card"
import { EmailInvitationCard } from "./components/email-invitation-card"
import { ReferralHistoryTab } from "./components/referral-history-tab"

export function InviteFriendsInterface() {
  const { referrals } = useReferrals()
  const [mounted, setMounted] = useState(false)
  const [referralLink, setReferralLink] = useState("")

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  // Resolve referral link from authenticated session user.
  useEffect(() => {
    let isMounted = true

    async function loadReferralLink() {
      try {
        const response = await fetch("/api/auth/me", { cache: "no-store" })
        const payload = await response.json()
        if (!isMounted || !response.ok) {
          return
        }

        const user = payload?.user as { username?: string; referral_url?: string } | null
        if (!user) {
          return
        }

        if (user.referral_url) {
          setReferralLink(user.referral_url)
          return
        }

        if (user.username && typeof window !== "undefined") {
          setReferralLink(`${window.location.origin}/invite/${user.username}`)
        }
      } catch {
        if (isMounted) {
          setReferralLink("")
        }
      }
    }

    loadReferralLink()

    return () => {
      isMounted = false
    }
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <div data-name="invite-friends-interface" className="space-y-6">
      <div data-name="invite-friends-header">
        <h1 className="text-3xl font-bold tracking-tight">Invite Friends</h1>
        <p className="text-muted-foreground mt-2">Invite your friends to DefibotX with your personal referral link</p>
      </div>

      <div data-name="invite-friends-cards" className="grid gap-6 md:grid-cols-2">
        <ReferralLinkCard referralLink={referralLink} />
        <EmailInvitationCard />
      </div>

      <Tabs data-name="invite-friends-tabs" defaultValue="referrals" className="w-full">
        <TabsList data-name="invite-friends-tabs-list" className="grid w-full grid-cols-1 md:w-[240px]">
          <TabsTrigger value="referrals">Referral History</TabsTrigger>
        </TabsList>

        <TabsContent data-name="invite-friends-referrals-tab" value="referrals" className="mt-6">
          <ReferralHistoryTab referrals={referrals} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
