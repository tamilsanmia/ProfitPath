"use client"

import type React from "react"
import { SettingsSection } from "../shared/settings-section"
import { PasswordSection } from "./password-section"
import { TwoFactorSection } from "./two-factor-section"
import { ActiveSessionsSection } from "./active-sessions-section"
import { LoginHistorySection } from "./login-history-section"
import type { SecuritySettings, Session, LoginHistory } from "../../types"
import { createSettingsTranslator } from "../../i18n"

interface SecurityTabProps {
  security: SecuritySettings
  sessions: Session[]
  loginHistory: LoginHistory[]
  onSecurityChange: (updates: Partial<SecuritySettings>) => void
  onSessionsChange: (sessions: Session[]) => void
  onLoginHistoryChange: (loginHistory: LoginHistory[]) => void
  language: string
}

export const SecurityTab: React.FC<SecurityTabProps> = ({
  security,
  sessions,
  loginHistory,
  onSecurityChange,
  onSessionsChange,
  onLoginHistoryChange,
  language,
}) => {
  const t = createSettingsTranslator(language)

  return (
    <div className="space-y-6">
      <SettingsSection title={t("security.password.title")} description={t("security.password.desc")}>
        <PasswordSection language={language} />
      </SettingsSection>

      <SettingsSection
        title={t("security.2fa.title")}
        description={t("security.2fa.desc")}
      >
        <TwoFactorSection
          isEnabled={security.twoFactorEnabled}
          onToggle={(enabled) => onSecurityChange({ twoFactorEnabled: enabled })}
          language={language}
        />
      </SettingsSection>

      <SettingsSection title={t("security.sessions.title")} description={t("security.sessions.desc")}>
        <ActiveSessionsSection
          sessions={sessions}
          onSessionsChange={onSessionsChange}
          onLoginHistoryChange={onLoginHistoryChange}
          language={language}
        />
      </SettingsSection>

      <SettingsSection title={t("security.history.title")} description={t("security.history.desc")}>
        <LoginHistorySection loginHistory={loginHistory} language={language} />
      </SettingsSection>
    </div>
  )
}
