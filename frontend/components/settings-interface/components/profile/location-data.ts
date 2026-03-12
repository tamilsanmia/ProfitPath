import locationData from "./location-data.json"

interface LocationDataJson {
  countries: CountryOption[]
  statesByCountry: Record<string, StateOption[]>
  timezonesByCountry: Record<string, string[]>
  allTimezones: string[]
}

export interface CountryOption {
  code: string
  name: string
}

export interface StateOption {
  code: string
  name: string
}

const DATA = locationData as LocationDataJson

export const COUNTRY_OPTIONS: CountryOption[] = DATA.countries

const COUNTRY_BY_CODE = new Map(COUNTRY_OPTIONS.map((country) => [country.code, country]))
const COUNTRY_BY_NAME = new Map(COUNTRY_OPTIONS.map((country) => [country.name, country]))

const intlWithSupportedValues = globalThis.Intl as typeof globalThis.Intl & {
  supportedValuesOf?: (key: string) => string[]
}

function buildAllTimezones(): string[] {
  const fromIntl = intlWithSupportedValues.supportedValuesOf?.("timeZone")
  if (fromIntl?.length) {
    return [...fromIntl].sort((a, b) => a.localeCompare(b))
  }

  return DATA.allTimezones
}

export const ALL_TIMEZONES = buildAllTimezones()

export function findCountryByName(countryName: string): CountryOption | undefined {
  return COUNTRY_BY_NAME.get(countryName)
}

export function findCountryByCode(countryCode: string): CountryOption | undefined {
  return COUNTRY_BY_CODE.get(countryCode)
}

export function getStatesByCountryCode(countryCode: string): StateOption[] {
  if (!countryCode) {
    return []
  }

  return DATA.statesByCountry[countryCode] ?? []
}

export function getCountryTimezones(countryCode: string): string[] {
  if (!countryCode) {
    return []
  }

  return DATA.timezonesByCountry[countryCode] ?? []
}

export function findStateName(countryCode: string, stateValue: string): string | undefined {
  if (!countryCode || !stateValue) {
    return undefined
  }

  const normalized = stateValue.trim().toLowerCase()
  const states = DATA.statesByCountry[countryCode] ?? []

  const byCode = states.find((state) => state.code.toLowerCase() === normalized)
  if (byCode) {
    return byCode.name
  }

  const byName = states.find((state) => state.name.trim().toLowerCase() === normalized)
  return byName?.name
}
