"use client";

import type React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCIES, LANGUAGES, TIMEZONES } from "@/components/settings-interface/constants";
import { SettingsSection } from "@/components/settings-interface/components/shared/settings-section";
import type { AdminPortalSettings } from "../../types";

interface LocalizationSectionProps {
  value: AdminPortalSettings["localization"];
  onChange: (updates: Partial<AdminPortalSettings["localization"]>) => void;
}

export const LocalizationSection: React.FC<LocalizationSectionProps> = ({ value, onChange }) => {
  return (
    <SettingsSection title="Localization" description="Default language, timezone, and regional formatting">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Default Language</Label>
          <Select value={value.language} onValueChange={(next) => onChange({ language: next })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((language) => (
                <SelectItem key={language.value} value={language.value}>{language.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Default Timezone</Label>
          <Select value={value.timezone} onValueChange={(next) => onChange({ timezone: next })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((timezone) => (
                <SelectItem key={timezone.value} value={timezone.value}>{timezone.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label htmlFor="date-format">Date Format</Label><Input id="date-format" value={value.dateFormat} onChange={(e) => onChange({ dateFormat: e.target.value })} /></div>
        <div className="space-y-2">
          <Label>Currency</Label>
          <Select value={value.currency || "USD"} onValueChange={(next) => onChange({ currency: next })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((currency) => (
                <SelectItem key={currency.value} value={currency.value}>{currency.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </SettingsSection>
  );
};
