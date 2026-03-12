"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Smartphone, Shield, Copy, Check } from "lucide-react"
import { toast } from "sonner"
import { createSettingsTranslator } from "../../i18n"

interface TwoFactorSectionProps {
  isEnabled: boolean
  onToggle: (enabled: boolean) => void
  language: string
}

export const TwoFactorSection: React.FC<TwoFactorSectionProps> = ({ isEnabled, onToggle, language }) => {
  const t = createSettingsTranslator(language)

  const [isSetupMode, setIsSetupMode] = useState(false)
  const [secretKey, setSecretKey] = useState("")
  const [otpauthUrl, setOtpauthUrl] = useState("")
  const [verificationCode, setVerificationCode] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [isRegenerateMode, setIsRegenerateMode] = useState(false)
  const [regenerateOtpCode, setRegenerateOtpCode] = useState("")
  const [regenerateBackupCode, setRegenerateBackupCode] = useState("")
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleStartSetup = async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/auth/2fa/setup", { method: "POST" })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? t("security.2fa.setupFailed"))
        return
      }

      setSecretKey(String(payload?.secret ?? ""))
      setOtpauthUrl(String(payload?.otpauth_url ?? ""))
      setVerificationCode("")
      setIsSetupMode(true)
    } catch {
      toast.error(t("security.2fa.setupFailed"))
    } finally {
      setIsLoading(false)
    }
  }

  const handleEnable2FA = async () => {
    if (!verificationCode) {
      toast.error(t("security.2fa.enterCode"))
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verificationCode.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? t("security.2fa.enableFailed"))
        return
      }

      onToggle(true)
      setBackupCodes(Array.isArray(payload?.backup_codes) ? payload.backup_codes.map((value: unknown) => String(value)) : [])
      setIsSetupMode(false)
      setVerificationCode("")
      toast.success(t("security.2fa.enabledSuccess"))
    } catch {
      toast.error(t("security.2fa.enableFailed"))
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisable2FA = async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/auth/2fa/disable", { method: "POST" })
      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? t("security.2fa.disableFailed"))
        return
      }

      onToggle(false)
      setSecretKey("")
      setOtpauthUrl("")
      setBackupCodes([])
      toast.success(t("security.2fa.disabledSuccess"))
    } catch {
      toast.error(t("security.2fa.disableFailed"))
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCode(text)
      setTimeout(() => setCopiedCode(null), 2000)
      toast.success(t("common.copied"))
    } catch (error) {
      toast.error(t("common.copyFailed"))
    }
  }

  const handleRegenerateBackupCodes = async () => {
    if (!regenerateOtpCode.trim() && !regenerateBackupCode.trim()) {
      toast.error(t("security.backup.authOrBackup"))
      return
    }

    setIsRegenerating(true)
    try {
      const response = await fetch("/api/auth/2fa/backup-codes/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otpCode: regenerateOtpCode.trim(),
          backupCode: regenerateBackupCode.trim(),
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        toast.error(payload?.error ?? t("security.backup.regenerateFailed"))
        return
      }

      setBackupCodes(Array.isArray(payload?.backup_codes) ? payload.backup_codes.map((value: unknown) => String(value)) : [])
      setRegenerateOtpCode("")
      setRegenerateBackupCode("")
      setIsRegenerateMode(false)
      toast.success(t("security.backup.regenerated"))
    } catch {
      toast.error(t("security.backup.regenerateFailed"))
    } finally {
      setIsRegenerating(false)
    }
  }

  if (isSetupMode) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("security.2fa.setupPrompt")}</p>
          <div className="flex items-center justify-start space-x-2">
            <code className="px-2 py-1 bg-muted rounded text-sm break-all">{secretKey}</code>
            <Button variant="ghost" size="sm" onClick={() => copyToClipboard(secretKey)}>
              {copiedCode === secretKey ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {otpauthUrl && <p className="text-xs text-muted-foreground break-all">URI: {otpauthUrl}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="verificationCode">{t("security.2fa.verificationCode")}</Label>
          <Input
            id="verificationCode"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            placeholder={t("security.2fa.verificationPlaceholder")}
            maxLength={6}
          />
        </div>

        <div className="flex space-x-2">
          <Button onClick={handleEnable2FA} disabled={isLoading}>
            {isLoading ? t("security.2fa.verifying") : t("security.2fa.enable")}
          </Button>
          <Button variant="outline" onClick={() => {
            setIsSetupMode(false)
            setVerificationCode("")
          }}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Shield className="h-4 w-4" />
            <span className="font-medium">{t("security.2fa.title")}</span>
            <Badge variant={isEnabled ? "default" : "secondary"}>{isEnabled ? t("security.2fa.enabled") : t("security.2fa.disabled")}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{t("security.2fa.desc")}</p>
        </div>

        {!isEnabled ? (
          <Button onClick={handleStartSetup} disabled={isLoading}>
            <Smartphone className="mr-2 h-4 w-4" />
            {isLoading ? t("security.2fa.loading") : t("security.2fa.enable")}
          </Button>
        ) : (
          <Button variant="destructive" onClick={handleDisable2FA} disabled={isLoading}>
            {isLoading ? t("security.2fa.disabling") : t("security.2fa.disable")}
          </Button>
        )}
      </div>

      {isEnabled && backupCodes.length > 0 && (
        <div className="p-4 border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">{t("security.backup.title")}</span>
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(backupCodes.join("\n"))}>
              <Copy className="mr-2 h-3 w-3" />
              {t("security.backup.copyAll")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t("security.backup.savedHint")}</p>
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code) => (
              <div key={code} className="flex items-center justify-between p-2 bg-muted rounded">
                <code className="text-sm">{code}</code>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(code)}>
                  {copiedCode === code ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {isEnabled && (
        <div className="p-4 border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">{t("security.backup.needNew")}</span>
            {!isRegenerateMode ? (
              <Button variant="outline" size="sm" onClick={() => setIsRegenerateMode(true)}>
                {t("security.backup.regenerate")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setIsRegenerateMode(false)}>
                {t("common.cancel")}
              </Button>
            )}
          </div>

          {isRegenerateMode && (
            <div className="space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t("security.backup.warning")}
              </div>
              <p className="text-sm text-muted-foreground">{t("security.backup.authOrBackup")}</p>
              <div className="grid gap-2">
                <Label htmlFor="regenerateOtpCode">{t("security.backup.authCode")}</Label>
                <Input
                  id="regenerateOtpCode"
                  value={regenerateOtpCode}
                  onChange={(event) => setRegenerateOtpCode(event.target.value)}
                  placeholder={t("security.backup.authCodePlaceholder")}
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="regenerateBackupCode">{t("security.backup.orBackup")}</Label>
                <Input
                  id="regenerateBackupCode"
                  value={regenerateBackupCode}
                  onChange={(event) => setRegenerateBackupCode(event.target.value)}
                  placeholder={t("security.backup.orBackupPlaceholder")}
                  maxLength={16}
                />
              </div>
              <Button onClick={handleRegenerateBackupCodes} disabled={isRegenerating}>
                {isRegenerating ? t("security.backup.regenerating") : t("security.backup.confirmRegenerate")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
