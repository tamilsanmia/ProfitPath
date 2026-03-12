"use client"

import { useState, useCallback, useEffect } from "react"
import { toast } from "@/components/ui/use-toast"
import { validateEmailList } from "../utils"
import type { InvitationFormData } from "../types"
import { DEFAULT_REFERRAL_MESSAGE } from "../constants"

export const useInvitations = () => {
  const [formData, setFormData] = useState<InvitationFormData>({
    emails: "",
    message: DEFAULT_REFERRAL_MESSAGE,
  })
  const [isSending, setIsSending] = useState(false)
  const [referralLink, setReferralLink] = useState("")

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

  const updateFormData = useCallback((updates: Partial<InvitationFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }))
  }, [])

  const sendInvitations = useCallback(async () => {
    if (!formData.emails.trim()) {
      toast({
        title: "No emails provided",
        description: "Please enter at least one email address.",
        variant: "destructive",
      })
      return
    }

    const { valid, invalid } = validateEmailList(formData.emails)

    if (invalid.length > 0) {
      toast({
        title: "Invalid email addresses",
        description: `Please check these emails: ${invalid.join(", ")}`,
        variant: "destructive",
      })
      return
    }

    setIsSending(true)
    try {
      const apiResponse = await fetch("/api/referrals/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: valid, message: formData.message }),
      })

      const apiPayload = await apiResponse.json()
      if (!apiResponse.ok) {
        throw new Error(apiPayload?.error ?? "Failed to send invitations")
      }

      window.dispatchEvent(new Event("pp-referrals-updated"))

      const subject = encodeURIComponent("Join me on DefibotX")
      const composedMessage = referralLink ? `${formData.message}\n\n${referralLink}` : formData.message
      const body = encodeURIComponent(composedMessage)
      const bcc = encodeURIComponent(valid.join(","))
      if (typeof window !== "undefined") {
        window.location.href = `mailto:?bcc=${bcc}&subject=${subject}&body=${body}`
      }

      toast({
        title: "Invitations sent!",
        description: `Created ${apiPayload?.created ?? valid.length} invitation(s).`,
      })

      setFormData((prev) => ({ ...prev, emails: "" }))
    } catch {
      toast({
        title: "Failed to send invitations",
        description: "Please try again later.",
        variant: "destructive",
      })
    } finally {
      setIsSending(false)
    }
  }, [formData, referralLink])

  return {
    formData,
    isSending,
    updateFormData,
    sendInvitations,
  }
}
