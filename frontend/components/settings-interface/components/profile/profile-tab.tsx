import type React from "react"
import { SettingsSection } from "../shared/settings-section"
import { AvatarUpload } from "./avatar-upload"
import { ProfileForm } from "./profile-form"
import { AddressInfo } from "./address-info"
import type { UserProfile } from "../../types"
import { createSettingsTranslator } from "../../i18n"

interface ProfileTabProps {
  profile: UserProfile
  onProfileChange: (updates: Partial<UserProfile>) => void
  language: string
}

export const ProfileTab: React.FC<ProfileTabProps> = ({ profile, onProfileChange, language }) => {
  const t = createSettingsTranslator(language)

  const handleAvatarChange = (avatar: string) => {
    onProfileChange({ avatar })
  }

  return (
    <div className="space-y-6">
      <SettingsSection title={t("profile.picture.title")} description={t("profile.picture.desc")}>
        <AvatarUpload
          currentAvatar={profile.avatar}
          userName={`${profile.firstName} ${profile.lastName}`}
          onAvatarChange={handleAvatarChange}
          language={language}
        />
      </SettingsSection>

      <SettingsSection title={t("profile.personal.title")} description={t("profile.personal.desc")}>
        <ProfileForm profile={profile} onProfileChange={onProfileChange} language={language} />
      </SettingsSection>

      <SettingsSection title={t("profile.address.title")} description={t("profile.address.desc")}>
        <AddressInfo profile={profile} onProfileChange={onProfileChange} language={language} />
      </SettingsSection>
    </div>
  )
}
