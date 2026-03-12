"use client"

import type React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { PasswordStrength } from "./password-strength"
import { usePassword } from "../../hooks/use-password"
import { toast } from "sonner"
import { createSettingsTranslator } from "../../i18n"

interface PasswordSectionProps {
  language: string
}

export const PasswordSection: React.FC<PasswordSectionProps> = ({ language }) => {
  const t = createSettingsTranslator(language)

  const {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    showPasswords,
    togglePasswordVisibility,
    passwordValidation,
    passwordStrength,
    isChanging,
    changePassword,
    reset,
  } = usePassword()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await changePassword()

    if (result.success) {
      toast.success(t("security.password.changed"))
      reset()
    } else {
      result.errors?.forEach((error) => toast.error(error))
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">{t("security.password.current")}</Label>
        <div className="relative">
          <Input
            id="currentPassword"
            type={showPasswords.current ? "text" : "password"}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t("security.password.placeholder.current")}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={() => togglePasswordVisibility("current")}
          >
            {showPasswords.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="newPassword">{t("security.password.new")}</Label>
        <div className="relative">
          <Input
            id="newPassword"
            type={showPasswords.new ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("security.password.placeholder.new")}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={() => togglePasswordVisibility("new")}
          >
            {showPasswords.new ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>

        {newPassword && (
          <PasswordStrength
            password={newPassword}
            score={passwordValidation.score}
            feedback={passwordValidation.feedback}
            strengthLabel={passwordStrength.label}
            strengthColor={passwordStrength.color}
          />
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("security.password.confirm")}</Label>
        <div className="relative">
          <Input
            id="confirmPassword"
            type={showPasswords.confirm ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t("security.password.placeholder.confirm")}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
            onClick={() => togglePasswordVisibility("confirm")}
          >
            {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>

        {confirmPassword && newPassword !== confirmPassword && (
          <p className="text-sm text-destructive">{t("security.password.mismatch")}</p>
        )}
      </div>

      <div className="flex space-x-2">
        <Button type="submit" disabled={isChanging || !passwordValidation.isValid || newPassword !== confirmPassword}>
          {isChanging ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("security.password.changing")}
            </>
          ) : (
            t("security.password.change")
          )}
        </Button>

        <Button type="button" variant="outline" onClick={reset}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  )
}
