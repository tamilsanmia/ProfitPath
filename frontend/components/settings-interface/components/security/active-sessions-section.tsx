"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { LogOut } from "lucide-react"
import { SessionItem } from "./session-item"
import type { LoginHistory, Session } from "../../types"
import { toast } from "sonner"
import { createSettingsTranslator } from "../../i18n"

interface ActiveSessionsSectionProps {
  sessions: Session[]
  onSessionsChange: (sessions: Session[]) => void
  onLoginHistoryChange: (loginHistory: LoginHistory[]) => void
  language: string
}

export const ActiveSessionsSection: React.FC<ActiveSessionsSectionProps> = ({
  sessions,
  onSessionsChange,
  onLoginHistoryChange,
  language,
}) => {
  const t = createSettingsTranslator(language)

  const [isTerminatingAll, setIsTerminatingAll] = useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)

  const refreshSessions = async () => {
    setIsLoadingSessions(true)
    try {
      const response = await fetch("/api/auth/sessions", { cache: "no-store" })
      const payload = await response.json()
      if (response.ok && Array.isArray(payload?.sessions)) {
        onSessionsChange(payload.sessions)
      }
    } finally {
      setIsLoadingSessions(false)
    }
  }

  const refreshLoginHistory = async () => {
    try {
      const response = await fetch("/api/auth/login-history", { cache: "no-store" })
      const payload = await response.json()
      if (response.ok && Array.isArray(payload?.loginHistory)) {
        onLoginHistoryChange(payload.loginHistory)
      }
    } catch {
      // Keep current list if refresh fails.
    }
  }

  const handleTerminateSession = async (sessionId: string) => {
    try {
      const response = await fetch("/api/auth/sessions/terminate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? t("security.sessions.terminateFailed"))
        return
      }

      await refreshSessions()
      await refreshLoginHistory()
      toast.success(t("security.sessions.terminated"))
    } catch (error) {
      toast.error(t("security.sessions.terminateFailed"))
    }
  }

  const handleTerminateAllSessions = async () => {
    setIsTerminatingAll(true)
    try {
      const response = await fetch("/api/auth/sessions/terminate-others", { method: "POST" })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? t("security.sessions.terminateAllFailed"))
        return
      }

      await refreshSessions()
      await refreshLoginHistory()

      toast.success(t("security.sessions.terminatedAll"))
    } catch (error) {
      toast.error(t("security.sessions.terminateAllFailed"))
    } finally {
      setIsTerminatingAll(false)
    }
  }

  const otherSessions = sessions.filter((session) => !session.current)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">{t("security.sessions.heading")}</h3>
          <p className="text-sm text-muted-foreground">{t("security.sessions.subheading")}</p>
        </div>

        {otherSessions.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <LogOut className="mr-2 h-4 w-4" />
                {t("security.sessions.terminateOthers")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("security.sessions.terminateDialogTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("security.sessions.terminateDialogDesc")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleTerminateAllSessions} disabled={isTerminatingAll}>
                  {isTerminatingAll ? t("security.sessions.terminating") : t("security.sessions.terminateAll")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="space-y-3">
        {isLoadingSessions && <p className="text-sm text-muted-foreground">{t("security.sessions.refreshing")}</p>}
        {sessions.map((session) => (
          <SessionItem key={session.id} session={session} onTerminate={handleTerminateSession} language={language} />
        ))}
      </div>

      {sessions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>{t("security.sessions.none")}</p>
        </div>
      )}
    </div>
  )
}
