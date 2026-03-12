"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { Referral, ReferralSettings, ReferralStats } from "../types"
import { defaultReferralSettings } from "../data"

type ApiReferral = {
  id: number
  invite_name: string
  status: "active" | "pending"
  created_at: string
}

type ApiSettings = {
  email_notifications: boolean
  show_in_leaderboard: boolean
  auto_share_achievements: boolean
}

function formatRelativeDate(value: string): string {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    return "just now"
  }

  const diffMs = Date.now() - timestamp
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMs / 3600000)
  const days = Math.floor(diffMs / 86400000)

  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function mapSettingsFromApi(settings: ApiSettings | null | undefined): ReferralSettings {
  if (!settings) {
    return defaultReferralSettings
  }

  return {
    emailNotifications: Boolean(settings.email_notifications),
    showInLeaderboard: Boolean(settings.show_in_leaderboard),
    autoShareAchievements: Boolean(settings.auto_share_achievements),
  }
}

export const useReferrals = () => {
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [settings, setSettings] = useState<ReferralSettings>(defaultReferralSettings)
  const [isLoading, setIsLoading] = useState(false)

  const stats = useMemo<ReferralStats>(() => {
    const totalInvites = referrals.length
    const pendingInvites = referrals.filter((referral) => referral.status === "pending").length
    const activeUsers = referrals.filter((referral) => referral.status === "active").length

    return {
      totalInvites,
      pendingInvites,
      activeUsers,
      totalEarned: 0,
      nextReward: 0,
      progressToNextReward: 0,
    }
  }, [referrals])

  const refreshStats = useCallback(async () => {
    setIsLoading(true)
    try {
      const [referralsResponse, settingsResponse] = await Promise.all([
        fetch("/api/referrals", { cache: "no-store" }),
        fetch("/api/referrals/settings", { cache: "no-store" }),
      ])

      const referralsPayload = await referralsResponse.json()
      const settingsPayload = await settingsResponse.json()

      const mappedReferrals = Array.isArray(referralsPayload?.referrals)
        ? (referralsPayload.referrals as ApiReferral[]).map((referral) => ({
            id: referral.id,
            name: referral.invite_name,
            status: referral.status,
            date: formatRelativeDate(referral.created_at),
          }))
        : []

      setReferrals(mappedReferrals)
      setSettings(mapSettingsFromApi(settingsPayload?.settings))
    } catch {
      setReferrals([])
      setSettings(defaultReferralSettings)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshStats()

    const handleUpdate = () => {
      void refreshStats()
    }

    window.addEventListener("pp-referrals-updated", handleUpdate)
    return () => {
      window.removeEventListener("pp-referrals-updated", handleUpdate)
    }
  }, [refreshStats])

  const updateSettings = useCallback(async (newSettings: Partial<ReferralSettings>) => {
    const optimistic = { ...settings, ...newSettings }
    setSettings(optimistic)

    try {
      const response = await fetch("/api/referrals/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_notifications: optimistic.emailNotifications,
          show_in_leaderboard: optimistic.showInLeaderboard,
          auto_share_achievements: optimistic.autoShareAchievements,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to persist referral settings")
      }

      const payload = await response.json()
      setSettings(mapSettingsFromApi(payload?.settings))
    } catch {
      await refreshStats()
    }
  }, [refreshStats, settings])

  return {
    stats,
    referrals,
    settings,
    isLoading,
    updateSettings,
    refreshStats,
  }
}
