import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ReferralItem } from "./referral-item"
import type { Referral } from "../types"

interface ReferralHistoryTabProps {
  referrals: Referral[]
}

export function ReferralHistoryTab({ referrals }: ReferralHistoryTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Referrals</CardTitle>
        <CardDescription>Track the status of your referrals</CardDescription>
      </CardHeader>
      <CardContent>
        {referrals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No referrals yet. Send your first invite above.</p>
        ) : (
          <div className="space-y-4">
            {referrals.map((referral) => (
              <ReferralItem key={referral.id} referral={referral} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
