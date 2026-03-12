"use client"

import { useEffect, useMemo } from "react"
import type React from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { detectClientGeo } from "@/lib/client-geo"
import type { UserProfile } from "../../types"
import { createSettingsTranslator } from "../../i18n"
import {
  COUNTRY_OPTIONS,
  findStateName,
  findCountryByName,
  getStatesByCountryCode,
  findCountryByCode,
} from "./location-data"

interface AddressInfoProps {
  profile: UserProfile
  onProfileChange: (updates: Partial<UserProfile>) => void
  language: string
}

export const AddressInfo: React.FC<AddressInfoProps> = ({ profile, onProfileChange, language }) => {
  const t = createSettingsTranslator(language)
  const selectedCountryCode =
    profile.countryCode || (profile.country ? findCountryByName(profile.country)?.code ?? "" : "")

  const stateOptions = useMemo(
    () => getStatesByCountryCode(selectedCountryCode),
    [selectedCountryCode],
  )

  useEffect(() => {
    const needsCountry = !profile.countryCode
    const needsState = !profile.state

    if (!needsCountry && !needsState) {
      return
    }

    let active = true

    const applyDetectedLocation = async () => {
      const detected = await detectClientGeo()
      if (!active || !detected.countryCode) {
        return
      }

      const country = findCountryByCode(detected.countryCode)
      const resolvedState = findStateName(
        detected.countryCode,
        detected.stateCode || detected.state,
      )

      onProfileChange({
        countryCode: needsCountry ? detected.countryCode : profile.countryCode,
        country: needsCountry ? (country?.name ?? detected.country) : profile.country,
        state: needsState ? (resolvedState ?? detected.state) : profile.state,
      })
    }

    void applyDetectedLocation()

    return () => {
      active = false
    }
  }, [onProfileChange, profile.country, profile.countryCode, profile.state])

  const handleInputChange =
    (field: keyof UserProfile) => (event: React.ChangeEvent<HTMLInputElement>) => {
      onProfileChange({ [field]: event.target.value })
    }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="md:col-span-2 space-y-2">
        <Label htmlFor="streetAddress">{t("profile.streetAddress")}</Label>
        <Input
          id="streetAddress"
          value={profile.streetAddress}
          onChange={handleInputChange("streetAddress")}
          placeholder={t("profile.placeholder.streetAddress")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="city">{t("profile.city")}</Label>
        <Input
          id="city"
          value={profile.city}
          onChange={handleInputChange("city")}
          placeholder={t("profile.placeholder.city")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="country">{t("profile.country")}</Label>
        <Select
          value={selectedCountryCode}
          onValueChange={(countryCode) => {
            const selectedCountry = findCountryByCode(countryCode)
            onProfileChange({
              countryCode,
              country: selectedCountry?.name ?? "",
              state: "",
            })
          }}
        >
          <SelectTrigger id="country">
            <SelectValue placeholder={t("profile.placeholder.country")} />
          </SelectTrigger>
          <SelectContent>
            {COUNTRY_OPTIONS.map((country) => (
              <SelectItem key={country.code} value={country.code}>
                {country.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="state">{t("profile.state")}</Label>
        <Select
          value={profile.state}
          onValueChange={(value) => onProfileChange({ state: value })}
          disabled={!selectedCountryCode || stateOptions.length === 0}
        >
          <SelectTrigger id="state">
            <SelectValue placeholder={t("profile.placeholder.state")} />
          </SelectTrigger>
          <SelectContent>
            {stateOptions.map((state) => (
              <SelectItem key={state.code} value={state.name}>
                {state.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="postalCode">{t("profile.postalCode")}</Label>
        <Input
          id="postalCode"
          value={profile.postalCode}
          onChange={handleInputChange("postalCode")}
          placeholder={t("profile.placeholder.postalCode")}
        />
      </div>
    </div>
  )
}
