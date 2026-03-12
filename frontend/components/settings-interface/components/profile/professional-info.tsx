"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type React from "react";
import type { UserProfile } from "../../types";
import { createSettingsTranslator } from "../../i18n";

interface ProfessionalInfoProps {
  profile: UserProfile;
  onProfileChange: (updates: Partial<UserProfile>) => void;
  language: string;
}

const EXPERIENCE_OPTIONS = [
  { value: "beginner", label: "Beginner (< 1 year)" },
  { value: "1-2", label: "1-2 years" },
  { value: "3-5", label: "3-5 years" },
  { value: "5+", label: "5+ years" },
  { value: "10+", label: "10+ years" },
];

export const ProfessionalInfo: React.FC<ProfessionalInfoProps> = ({ profile, onProfileChange, language }) => {
  const t = createSettingsTranslator(language);

  const handleInputChange = (field: keyof UserProfile) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onProfileChange({ [field]: event.target.value });
  };

  const handleExperienceChange = (value: string) => {
    onProfileChange({ experience: value });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="company">{t("profile.company")}</Label>
        <Input id="company" value={profile.company || ""} onChange={handleInputChange("company")} placeholder={t("profile.placeholder.company")} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="position">{t("profile.position")}</Label>
        <Input id="position" value={profile.position || ""} onChange={handleInputChange("position")} placeholder={t("profile.placeholder.position")} />
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="experience">{t("profile.tradingExperience")}</Label>
        <select
          id="experience"
          value={profile.experience || ""}
          onChange={(event) => handleExperienceChange(event.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">{t("profile.experience.select")}</option>
          {EXPERIENCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
