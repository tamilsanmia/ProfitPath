"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import type {
  SettingsState,
  Connection,
  UserProfile,
  SecuritySettings,
  NotificationSettings,
  AppearanceSettings,
  TradingSettings,
  BotSettings,
  PrivacySettings,
  DataSettings,
} from "../types"
import { defaultSettingsState } from "../data"
import { hasUnsavedChanges, deepClone } from "../utils"
import { emitAvatarUpdated } from "@/lib/local-avatar"

type SessionUser = {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string | null
  country?: string | null
}

function normalizeAvatarValue(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }

  const normalized = value.trim()
  if (!normalized || normalized === "/placeholder-user.jpg") {
    return ""
  }

  return normalized
}

function detectBrowserTimezone(): string {
  if (typeof Intl === "undefined") {
    return "UTC"
  }

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

type ThemePreference = "light" | "dark" | "system"

function getStoredThemePreference(): ThemePreference | null {
  if (typeof window === "undefined") {
    return null
  }

  const raw = window.localStorage.getItem("theme")
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw
  }

  return null
}

function getTimezonePreferenceKey(email?: string): string {
  return `pp_timezone_user_set:${email ?? "guest"}`
}

function hasUserExplicitTimezonePreference(email?: string): boolean {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem(getTimezonePreferenceKey(email)) === "1"
}

function markUserExplicitTimezonePreference(email?: string): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(getTimezonePreferenceKey(email), "1")
}

function applyAppearanceToDocument(appearance: AppearanceSettings): void {
  if (typeof document === "undefined") {
    return
  }

  const root = document.documentElement
  const body = document.body

  const storedTheme = getStoredThemePreference()
  const preferredTheme: ThemePreference = storedTheme ?? appearance.theme

  root.classList.remove("light", "dark")
  if (preferredTheme === "light" || preferredTheme === "dark") {
    root.classList.add(preferredTheme)
    root.setAttribute("data-theme", preferredTheme)
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
    const resolvedTheme = prefersDark ? "dark" : "light"
    root.classList.add(resolvedTheme)
    root.setAttribute("data-theme", "system")
  }

  root.lang = appearance.language || "en"
  root.setAttribute("data-density", appearance.density)
  root.setAttribute("data-time-format", appearance.timeFormat)
  root.setAttribute("data-date-format", appearance.dateFormat)
  root.setAttribute("data-timezone", appearance.timezone)

  const accessibility = appearance.accessibility
  body.toggleAttribute("data-high-contrast", accessibility.highContrast)
  body.toggleAttribute("data-reduced-motion", accessibility.reducedMotion)
  body.toggleAttribute("data-large-text", accessibility.largeText)
  body.toggleAttribute("data-screen-reader", accessibility.screenReader)
}

function mergeSettings(base: Omit<SettingsState, "hasUnsavedChanges">, incoming: unknown): Omit<SettingsState, "hasUnsavedChanges"> {
  if (!incoming || typeof incoming !== "object") {
    return base
  }

  const candidate = incoming as Partial<Omit<SettingsState, "hasUnsavedChanges">>
  return {
    ...base,
    ...candidate,
    profile: {
      ...base.profile,
      ...(candidate.profile ?? {}),
      socialProfiles: {
        ...base.profile.socialProfiles,
        ...(candidate.profile?.socialProfiles ?? {}),
      },
    },
    security: { ...base.security, ...(candidate.security ?? {}) },
    notifications: {
      ...base.notifications,
      ...(candidate.notifications ?? {}),
      email: { ...base.notifications.email, ...(candidate.notifications?.email ?? {}) },
      push: { ...base.notifications.push, ...(candidate.notifications?.push ?? {}) },
      sms: { ...base.notifications.sms, ...(candidate.notifications?.sms ?? {}) },
      inApp: { ...base.notifications.inApp, ...(candidate.notifications?.inApp ?? {}) },
    },
    appearance: {
      ...base.appearance,
      ...(candidate.appearance ?? {}),
      accessibility: {
        ...base.appearance.accessibility,
        ...(candidate.appearance?.accessibility ?? {}),
      },
    },
    trading: {
      ...base.trading,
      ...(candidate.trading ?? {}),
      orderDefaults: {
        ...base.trading.orderDefaults,
        ...(candidate.trading?.orderDefaults ?? {}),
      },
      riskManagement: {
        ...base.trading.riskManagement,
        ...(candidate.trading?.riskManagement ?? {}),
      },
      chartPreferences: {
        ...base.trading.chartPreferences,
        ...(candidate.trading?.chartPreferences ?? {}),
      },
    },
    bots: {
      ...base.bots,
      ...(candidate.bots ?? {}),
      defaultParameters: {
        ...base.bots.defaultParameters,
        ...(candidate.bots?.defaultParameters ?? {}),
      },
      riskManagement: {
        ...base.bots.riskManagement,
        ...(candidate.bots?.riskManagement ?? {}),
      },
      behavior: {
        ...base.bots.behavior,
        ...(candidate.bots?.behavior ?? {}),
      },
      monitoring: {
        ...base.bots.monitoring,
        ...(candidate.bots?.monitoring ?? {}),
      },
    },
    privacy: {
      ...base.privacy,
      ...(candidate.privacy ?? {}),
      dataSharing: { ...base.privacy.dataSharing, ...(candidate.privacy?.dataSharing ?? {}) },
      profilePrivacy: { ...base.privacy.profilePrivacy, ...(candidate.privacy?.profilePrivacy ?? {}) },
      cookiesTracking: { ...base.privacy.cookiesTracking, ...(candidate.privacy?.cookiesTracking ?? {}) },
      securityPrivacy: { ...base.privacy.securityPrivacy, ...(candidate.privacy?.securityPrivacy ?? {}) },
    },
    data: {
      ...base.data,
      ...(candidate.data ?? {}),
      retention: { ...base.data.retention, ...(candidate.data?.retention ?? {}) },
      export: { ...base.data.export, ...(candidate.data?.export ?? {}) },
    },
    connections: Array.isArray(candidate.connections) ? candidate.connections : base.connections,
    sessions: Array.isArray(candidate.sessions) ? candidate.sessions : base.sessions,
    loginHistory: Array.isArray(candidate.loginHistory) ? candidate.loginHistory : base.loginHistory,
    activeTab: candidate.activeTab ?? base.activeTab,
    isLoading: false,
  }
}

export const useSettings = () => {
  const [settings, setSettings] = useState<Omit<SettingsState, "hasUnsavedChanges">>(() => {
    const { hasUnsavedChanges: _, ...settingsWithoutFlag } = defaultSettingsState
    return settingsWithoutFlag
  })
  const [originalSettings, setOriginalSettings] = useState<Omit<SettingsState, "hasUnsavedChanges">>(() => {
    const { hasUnsavedChanges: _, ...settingsWithoutFlag } = defaultSettingsState
    return settingsWithoutFlag
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [sessionEmail, setSessionEmail] = useState<string | undefined>(undefined)

  const hasUnsavedChangesFlag = useMemo(() => {
    return hasUnsavedChanges(originalSettings, settings)
  }, [originalSettings, settings])

  useEffect(() => {
    applyAppearanceToDocument(settings.appearance)
  }, [settings.appearance])

  useEffect(() => {
    let isMounted = true

    async function loadSettings() {
      setIsLoading(true)
      try {
        const [meResponse, settingsResponse, sessionsResponse, loginHistoryResponse] = await Promise.all([
          fetch("/api/auth/me", { cache: "no-store" }),
          fetch("/api/settings", { cache: "no-store" }),
          fetch("/api/auth/sessions", { cache: "no-store" }),
          fetch("/api/auth/login-history", { cache: "no-store" }),
        ])

        const mePayload = await meResponse.json()
        const settingsPayload = await settingsResponse.json()
        const sessionsPayload = await sessionsResponse.json()
        const loginHistoryPayload = await loginHistoryResponse.json()

        const user = meResponse.ok ? (mePayload?.user as SessionUser | undefined) : undefined
        const email = user?.email
        if (isMounted) {
          setSessionEmail(email)
        }

        const base = deepClone(defaultSettingsState)
        const { hasUnsavedChanges: _, ...baseWithoutFlag } = base

        const hydratedBase: Omit<SettingsState, "hasUnsavedChanges"> = {
          ...baseWithoutFlag,
          profile: {
            ...baseWithoutFlag.profile,
            firstName: user?.first_name ?? baseWithoutFlag.profile.firstName,
            lastName: user?.last_name ?? baseWithoutFlag.profile.lastName,
            email: user?.email ?? baseWithoutFlag.profile.email,
            phone: user?.phone ?? "",
            location: user?.country ?? baseWithoutFlag.profile.location,
          },
          appearance: {
            ...baseWithoutFlag.appearance,
            timezone: detectBrowserTimezone(),
          },
        }

        const merged = mergeSettings(hydratedBase, settingsPayload?.settings)
        merged.profile.avatar = normalizeAvatarValue(merged.profile.avatar)

        const browserTimezone = detectBrowserTimezone()
        const currentTimezone = String(merged.appearance.timezone || "").trim()
        const shouldAutoDetectTimezone =
          !hasUserExplicitTimezonePreference(email) &&
          (!currentTimezone || currentTimezone === "UTC" || currentTimezone === defaultSettingsState.appearance.timezone)

        if (shouldAutoDetectTimezone) {
          merged.appearance.timezone = browserTimezone
        }

        if (Array.isArray(sessionsPayload?.sessions)) {
          merged.sessions = sessionsPayload.sessions
        }
        if (Array.isArray(loginHistoryPayload?.loginHistory)) {
          merged.loginHistory = loginHistoryPayload.loginHistory
        }
        const withAvatar = merged

        if (!isMounted) {
          return
        }

        setSettings(withAvatar)
        setOriginalSettings(deepClone(withAvatar))
      } catch {
        if (isMounted) {
          const fallback = deepClone(defaultSettingsState)
          const { hasUnsavedChanges: _, ...settingsWithoutFlag } = fallback
          setSettings(settingsWithoutFlag)
          setOriginalSettings(deepClone(settingsWithoutFlag))
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadSettings()
    return () => {
      isMounted = false
    }
  }, [])

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    const email = sessionEmail ?? settings.profile.email

    setSettings((prev) => ({
      ...prev,
      profile: { ...prev.profile, ...updates },
    }))

    if (typeof updates.avatar === "string") {
      emitAvatarUpdated({ email, avatarUrl: updates.avatar })
    }
  }, [sessionEmail, settings.profile.email])

  const updateSecurity = useCallback((updates: Partial<SecuritySettings>) => {
    setSettings((prev) => ({
      ...prev,
      security: { ...prev.security, ...updates },
    }))
  }, [])

  const updateNotifications = useCallback((updates: Partial<NotificationSettings>) => {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, ...updates },
    }))
  }, [])

  const updateAppearance = useCallback((updates: Partial<AppearanceSettings>) => {
    if (typeof updates.timezone === "string" && updates.timezone.trim()) {
      markUserExplicitTimezonePreference(sessionEmail)
    }

    if (typeof updates.theme === "string" && (updates.theme === "light" || updates.theme === "dark" || updates.theme === "system")) {
      window.localStorage.setItem("theme", updates.theme)
    }

    setSettings((prev) => ({
      ...prev,
      appearance: {
        ...prev.appearance,
        ...updates,
        accessibility: {
          ...prev.appearance.accessibility,
          ...(updates.accessibility ?? {}),
        },
      },
    }))
  }, [sessionEmail])

  const updateTrading = useCallback((updates: Partial<TradingSettings>) => {
    setSettings((prev) => ({
      ...prev,
      trading: { ...prev.trading, ...updates },
    }))
  }, [])

  const updateBots = useCallback((updates: Partial<BotSettings>) => {
    setSettings((prev) => ({
      ...prev,
      bots: { ...prev.bots, ...updates },
    }))
  }, [])

  const updatePrivacy = useCallback((updates: Partial<PrivacySettings>) => {
    setSettings((prev) => ({
      ...prev,
      privacy: { ...prev.privacy, ...updates },
    }))
  }, [])

  const updateData = useCallback((updates: Partial<DataSettings>) => {
    setSettings((prev) => ({
      ...prev,
      data: { ...prev.data, ...updates },
    }))
  }, [])

  const updateConnections = useCallback((connections: Connection[]) => {
    setSettings((prev) => ({
      ...prev,
      connections,
    }))
  }, [])

  const persistConnections = useCallback(async (connections: Connection[]) => {
    setIsSaving(true)
    try {
      const nextSettings = {
        ...settings,
        connections,
      }

      setSettings((prev) => ({
        ...prev,
        connections,
      }))

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: nextSettings }),
      })

      const payload = await response.json()
      if (!response.ok) {
        return { success: false, error: payload?.error ?? "Failed to save connections" }
      }

      const mergedSaved = mergeSettings(settings, payload?.settings)
      mergedSaved.profile.avatar = normalizeAvatarValue(mergedSaved.profile.avatar)
      setSettings(mergedSaved)
      setOriginalSettings(deepClone(mergedSaved))
      return { success: true }
    } catch {
      return { success: false, error: "Failed to save connections" }
    } finally {
      setIsSaving(false)
    }
  }, [settings])

  const updateSessions = useCallback((sessions: SettingsState["sessions"]) => {
    setSettings((prev) => ({
      ...prev,
      sessions,
    }))
  }, [])

  const updateLoginHistory = useCallback((loginHistory: SettingsState["loginHistory"]) => {
    setSettings((prev) => ({
      ...prev,
      loginHistory,
    }))
  }, [])

  const setActiveTab = useCallback((tab: string) => {
    setSettings((prev) => ({ ...prev, activeTab: tab }))
  }, [])

  const saveSettings = useCallback(async () => {
    setIsSaving(true)
    try {
      const settingsToPersist = {
        ...settings,
      }

      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: settingsToPersist }),
      })

      const payload = await response.json()
      if (!response.ok) {
        return { success: false, error: payload?.error ?? "Failed to save settings" }
      }

      const mergedSaved = mergeSettings(settings, payload?.settings)
      mergedSaved.profile.avatar = normalizeAvatarValue(mergedSaved.profile.avatar)
      const withAvatar = mergedSaved
      setSettings(withAvatar)
      setOriginalSettings(deepClone(withAvatar))
      return { success: true }
    } catch {
      return { success: false, error: "Failed to save settings" }
    } finally {
      setIsSaving(false)
    }
  }, [sessionEmail, settings])

  const resetSettings = useCallback(() => {
    setSettings(deepClone(originalSettings))
  }, [originalSettings])

  const resetToDefaults = useCallback(() => {
    const { hasUnsavedChanges: _, ...settingsWithoutFlag } = defaultSettingsState
    setSettings({
      ...settingsWithoutFlag,
      appearance: {
        ...settingsWithoutFlag.appearance,
        timezone: detectBrowserTimezone(),
      },
    })
  }, [])

  const settingsWithFlag = useMemo(
    () => ({
      ...settings,
      hasUnsavedChanges: hasUnsavedChangesFlag,
    }),
    [settings, hasUnsavedChangesFlag],
  )

  return {
    settings: settingsWithFlag,
    isLoading,
    isSaving,
    updateProfile,
    updateSecurity,
    updateNotifications,
    updateAppearance,
    updateTrading,
    updateBots,
    updatePrivacy,
    updateData,
    updateConnections,
    persistConnections,
    updateSessions,
    updateLoginHistory,
    setActiveTab,
    saveSettings,
    resetSettings,
    resetToDefaults,
  }
}
