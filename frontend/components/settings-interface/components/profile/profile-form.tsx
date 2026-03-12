"use client"

import type React from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { UserProfile } from "../../types"
import { validateEmail, validatePhone } from "../../utils"
import { createSettingsTranslator } from "../../i18n"

interface ProfileFormProps {
  profile: UserProfile
  onProfileChange: (updates: Partial<UserProfile>) => void
  language: string
}

const TITLES = ["Mr.", "Mrs.", "Ms.", "Miss", "Dr.", "Prof."]

export const ProfileForm: React.FC<ProfileFormProps> = ({ profile, onProfileChange, language }) => {
  const t = createSettingsTranslator(language)

  const handleInputChange =
    (field: keyof UserProfile) => (event: React.ChangeEvent<HTMLInputElement>) => {
      onProfileChange({ [field]: event.target.value })
    }

  const isEmailValid = validateEmail(profile.email)
  const isPhoneValid = validatePhone(profile.phone)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="title">{t("profile.title")}</Label>
        <Select value={profile.title} onValueChange={(value) => onProfileChange({ title: value })}>
          <SelectTrigger id="title">
            <SelectValue placeholder={t("profile.placeholder.title")} />
          </SelectTrigger>
          <SelectContent>
            {TITLES.map((title) => (
              <SelectItem key={title} value={title}>
                {title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="firstName">{t("profile.firstName")}</Label>
        <Input
          id="firstName"
          value={profile.firstName}
          onChange={handleInputChange("firstName")}
          placeholder={t("profile.placeholder.firstName")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="lastName">{t("profile.lastName")}</Label>
        <Input
          id="lastName"
          value={profile.lastName}
          onChange={handleInputChange("lastName")}
          placeholder={t("profile.placeholder.lastName")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dateOfBirth">{t("profile.dateOfBirth")}</Label>
        <Input
          id="dateOfBirth"
          type="date"
          value={profile.dateOfBirth}
          onChange={handleInputChange("dateOfBirth")}
          placeholder={t("profile.placeholder.dateOfBirth")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t("profile.email")}</Label>
        <Input
          id="email"
          type="email"
          value={profile.email}
          onChange={handleInputChange("email")}
          placeholder={t("profile.placeholder.email")}
          className={!isEmailValid && profile.email ? "border-destructive" : ""}
        />
        {!isEmailValid && profile.email && (
          <p className="text-sm text-destructive">{t("profile.error.invalidEmail")}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">{t("profile.phone")}</Label>
        <Input
          id="phone"
          type="tel"
          value={profile.phone}
          onChange={handleInputChange("phone")}
          placeholder={t("profile.placeholder.phone")}
          className={!isPhoneValid && profile.phone ? "border-destructive" : ""}
        />
        {!isPhoneValid && profile.phone && (
          <p className="text-sm text-destructive">{t("profile.error.invalidPhone")}</p>
        )}
      </div>

    </div>
  )
}
