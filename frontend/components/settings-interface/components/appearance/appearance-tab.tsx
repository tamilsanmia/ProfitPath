"use client"

import type React from "react"
import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SettingsSelect } from "../shared/settings-select"
import { SettingsToggle } from "../shared/settings-toggle"
import { Monitor, Moon, Sun, Palette, Globe, Clock } from "lucide-react"
import type { AppearanceSettings } from "../../types"
import { CURRENCIES, LANGUAGES, TIMEZONES } from "../../constants"
import { createSettingsTranslator } from "../../i18n"

interface AppearanceTabProps {
  appearance: AppearanceSettings
  onAppearanceChange: (updates: Partial<AppearanceSettings>) => void
}

export const AppearanceTab: React.FC<AppearanceTabProps> = ({ appearance, onAppearanceChange }) => {
  const t = createSettingsTranslator(appearance.language)

  const previewNow = useMemo(() => new Date(), [appearance.language, appearance.timezone, appearance.dateFormat, appearance.timeFormat])

  const locale = useMemo(() => {
    const map: Record<string, string> = {
      en: "en-US",
      es: "es-ES",
      fr: "fr-FR",
      de: "de-DE",
      it: "it-IT",
      pt: "pt-PT",
      ru: "ru-RU",
      zh: "zh-CN",
      ja: "ja-JP",
      ko: "ko-KR",
    }

    return map[appearance.language] ?? "en-US"
  }, [appearance.language])

  const previewDate = useMemo(() => {
    const twoDigit = { day: "2-digit" as const, month: "2-digit" as const, year: "numeric" as const, timeZone: appearance.timezone }
    const yearFirst = { day: "2-digit" as const, month: "2-digit" as const, year: "numeric" as const, timeZone: appearance.timezone }

    if (appearance.dateFormat === "YYYY-MM-DD") {
      const parts = new Intl.DateTimeFormat(locale, yearFirst).formatToParts(previewNow)
      const year = parts.find((p) => p.type === "year")?.value ?? "0000"
      const month = parts.find((p) => p.type === "month")?.value ?? "00"
      const day = parts.find((p) => p.type === "day")?.value ?? "00"
      return `${year}-${month}-${day}`
    }

    const parts = new Intl.DateTimeFormat(locale, twoDigit).formatToParts(previewNow)
    const month = parts.find((p) => p.type === "month")?.value ?? "00"
    const day = parts.find((p) => p.type === "day")?.value ?? "00"
    const year = parts.find((p) => p.type === "year")?.value ?? "0000"

    if (appearance.dateFormat === "DD/MM/YYYY") {
      return `${day}/${month}/${year}`
    }

    return `${month}/${day}/${year}`
  }, [appearance.dateFormat, appearance.timezone, locale, previewNow])

  const previewTime = useMemo(() => {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: appearance.timeFormat === "12h",
      timeZone: appearance.timezone,
    }).format(previewNow)
  }, [appearance.timeFormat, appearance.timezone, locale, previewNow])

  const handleThemeChange = (theme: string) => {
    onAppearanceChange({ theme: theme as "light" | "dark" | "system" })
  }

  const handleDensityChange = (density: string) => {
    onAppearanceChange({ density: density as "compact" | "comfortable" | "spacious" })
  }

  const handleLanguageChange = (language: string) => {
    onAppearanceChange({ language })
  }

  const handleCurrencyChange = (currency: string) => {
    onAppearanceChange({ currency })
  }

  const handleTimezoneChange = (timezone: string) => {
    onAppearanceChange({ timezone })
  }

  const handleDateFormatChange = (dateFormat: string) => {
    onAppearanceChange({ dateFormat })
  }

  const handleTimeFormatChange = (timeFormat: string) => {
    onAppearanceChange({ timeFormat: timeFormat as "12h" | "24h" })
  }

  const handleAccessibilityChange = (key: keyof AppearanceSettings["accessibility"], value: boolean) => {
    onAppearanceChange({
      accessibility: { ...appearance.accessibility, [key]: value },
    })
  }

  const themeOptions = [
    { value: "light", label: t("appearance.light") },
    { value: "dark", label: t("appearance.dark") },
    { value: "system", label: t("appearance.system") },
  ]

  const densityOptions = [
    { value: "compact", label: t("appearance.compact") },
    { value: "comfortable", label: t("appearance.comfortable") },
    { value: "spacious", label: t("appearance.spacious") },
  ]

  const dateFormatOptions = [
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
  ]

  const timeFormatOptions = [
    { value: "12h", label: t("appearance.time12") },
    { value: "24h", label: t("appearance.time24") },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t("appearance.title")}</h2>
        <p className="text-muted-foreground">{t("appearance.subtitle")}</p>
      </div>

      {/* Theme Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Palette className="h-5 w-5" />
            <span>{t("appearance.themeDisplay")}</span>
          </CardTitle>
          <CardDescription>{t("appearance.themeDisplayDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="theme"
            label={t("appearance.theme")}
            description={t("appearance.themeDesc")}
            value={appearance.theme}
            onValueChange={handleThemeChange}
            options={themeOptions}
          />

          <SettingsSelect
            id="density"
            label={t("appearance.density")}
            description={t("appearance.densityDesc")}
            value={appearance.density}
            onValueChange={handleDensityChange}
            options={densityOptions}
          />

          {/* Theme Preview */}
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="text-center">
              <div className="w-full h-20 bg-white border-2 border-gray-200 rounded-lg mb-2 flex items-center justify-center">
                <Sun className="h-6 w-6 text-yellow-500" />
              </div>
              <span className="text-sm">{t("appearance.light")}</span>
            </div>
            <div className="text-center">
              <div className="w-full h-20 bg-gray-900 border-2 border-gray-700 rounded-lg mb-2 flex items-center justify-center">
                <Moon className="h-6 w-6 text-blue-400" />
              </div>
              <span className="text-sm">{t("appearance.dark")}</span>
            </div>
            <div className="text-center">
              <div className="w-full h-20 bg-gradient-to-br from-white to-gray-900 border-2 border-gray-400 rounded-lg mb-2 flex items-center justify-center">
                <Monitor className="h-6 w-6 text-gray-600" />
              </div>
              <span className="text-sm">{t("appearance.system")}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Language & Region */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Globe className="h-5 w-5" />
            <span>{t("appearance.languageRegion")}</span>
          </CardTitle>
          <CardDescription>{t("appearance.languageRegionDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="language"
            label={t("appearance.language")}
            description={t("appearance.languageDesc")}
            value={appearance.language}
            onValueChange={handleLanguageChange}
            options={LANGUAGES}
          />

          <SettingsSelect
            id="timezone"
            label={t("appearance.timezone")}
            description={t("appearance.timezoneDesc")}
            value={appearance.timezone}
            onValueChange={handleTimezoneChange}
            options={TIMEZONES}
          />

          <SettingsSelect
            id="currency"
            label="Currency"
            description="Choose the default display currency for money values"
            value={appearance.currency}
            onValueChange={handleCurrencyChange}
            options={CURRENCIES}
          />
        </CardContent>
      </Card>

      {/* Date & Time Format */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Clock className="h-5 w-5" />
            <span>{t("appearance.dateTime")}</span>
          </CardTitle>
          <CardDescription>{t("appearance.dateTimeDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="dateFormat"
            label={t("appearance.dateFormat")}
            description={t("appearance.dateFormatDesc")}
            value={appearance.dateFormat}
            onValueChange={handleDateFormatChange}
            options={dateFormatOptions}
          />

          <SettingsSelect
            id="timeFormat"
            label={t("appearance.timeFormat")}
            description={t("appearance.timeFormatDesc")}
            value={appearance.timeFormat}
            onValueChange={handleTimeFormatChange}
            options={timeFormatOptions}
          />

          {/* Format Preview */}
          <div className="p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">{t("appearance.preview")}</h4>
            <div className="space-y-1 text-sm">
              <div>{t("appearance.date")}: {previewDate}</div>
              <div>{t("appearance.time")}: {previewTime}</div>
              <div>{t("appearance.timezoneValue")}: {appearance.timezone}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accessibility */}
      <Card>
        <CardHeader>
          <CardTitle>{t("appearance.accessibility")}</CardTitle>
          <CardDescription>{t("appearance.accessibilityDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="high-contrast"
            label={t("appearance.highContrast")}
            description={t("appearance.highContrastDesc")}
            checked={appearance.accessibility.highContrast}
            onCheckedChange={(checked) => handleAccessibilityChange("highContrast", checked)}
          />

          <SettingsToggle
            id="reduced-motion"
            label={t("appearance.reducedMotion")}
            description={t("appearance.reducedMotionDesc")}
            checked={appearance.accessibility.reducedMotion}
            onCheckedChange={(checked) => handleAccessibilityChange("reducedMotion", checked)}
          />

          <SettingsToggle
            id="large-text"
            label={t("appearance.largeText")}
            description={t("appearance.largeTextDesc")}
            checked={appearance.accessibility.largeText}
            onCheckedChange={(checked) => handleAccessibilityChange("largeText", checked)}
          />

          <SettingsToggle
            id="screen-reader"
            label={t("appearance.screenReader")}
            description={t("appearance.screenReaderDesc")}
            checked={appearance.accessibility.screenReader}
            onCheckedChange={(checked) => handleAccessibilityChange("screenReader", checked)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
