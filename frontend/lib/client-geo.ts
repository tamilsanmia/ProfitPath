export interface ClientGeoResult {
  countryCode: string
  country: string
  state: string
  stateCode: string
  timezone: string
}

let cachedGeoPromise: Promise<ClientGeoResult> | null = null

function detectTimezoneFromBrowser(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ""
  } catch {
    return ""
  }
}

function detectCountryCodeFromLocale(): string {
  if (typeof navigator === "undefined") {
    return ""
  }

  const localeCandidates = [
    navigator.language,
    ...(navigator.languages ?? []),
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].filter(Boolean)

  for (const locale of localeCandidates) {
    const normalized = String(locale).replace("_", "-")
    const parts = normalized.split("-")
    const tail = parts[parts.length - 1]?.toUpperCase() ?? ""
    if (tail.length === 2) {
      return tail
    }

    try {
      const maximized = new Intl.Locale(normalized).maximize().region
      if (maximized && maximized.length === 2) {
        return maximized.toUpperCase()
      }
    } catch {
      // Ignore invalid locale strings.
    }
  }

  return ""
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timeout)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeout)
        reject(error)
      })
  })
}

async function detectGeoFromBrowserLocation(): Promise<Partial<ClientGeoResult>> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return {}
  }

  try {
    const position = await withTimeout(
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 2500,
          maximumAge: 300000,
        })
      }),
      3000,
    )

    const latitude = position.coords.latitude
    const longitude = position.coords.longitude

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(
        String(latitude),
      )}&longitude=${encodeURIComponent(String(longitude))}&localityLanguage=en`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
    clearTimeout(timeout)

    if (!response.ok) {
      return {}
    }

    const payload = (await response.json()) as {
      countryCode?: string
      countryName?: string
      principalSubdivision?: string
      principalSubdivisionCode?: string
      timezone?: string
    }

    return {
      countryCode: String(payload.countryCode ?? "").toUpperCase(),
      country: String(payload.countryName ?? ""),
      state: String(payload.principalSubdivision ?? ""),
      stateCode: String(payload.principalSubdivisionCode ?? "").toUpperCase(),
      timezone: String(payload.timezone ?? ""),
    }
  } catch {
    return {}
  }
}

async function detectGeoFromDirectIpApi(): Promise<Partial<ClientGeoResult>> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const response = await fetch("https://ipapi.co/json/", {
      cache: "no-store",
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return {}
    }

    const payload = (await response.json()) as {
      country_code?: string
      country_name?: string
      region?: string
      region_code?: string
      timezone?: string
    }

    return {
      countryCode: String(payload.country_code ?? "").toUpperCase(),
      country: String(payload.country_name ?? ""),
      state: String(payload.region ?? ""),
      stateCode: String(payload.region_code ?? "").toUpperCase(),
      timezone: String(payload.timezone ?? ""),
    }
  } catch {
    return {}
  }
}

async function detectGeoFromPublicIp(): Promise<Partial<ClientGeoResult>> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const response = await fetch("/api/geo/country", {
      cache: "no-store",
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return detectGeoFromDirectIpApi()
    }

    const payload = (await response.json()) as {
      countryCode?: string
      country?: string
      state?: string
      stateCode?: string
      timezone?: string
    }

    const internal = {
      countryCode: String(payload.countryCode ?? "").toUpperCase(),
      country: String(payload.country ?? ""),
      state: String(payload.state ?? ""),
      stateCode: String(payload.stateCode ?? "").toUpperCase(),
      timezone: String(payload.timezone ?? ""),
    }

    if (internal.countryCode || internal.timezone || internal.state) {
      return internal
    }

    return detectGeoFromDirectIpApi()
  } catch {
    return detectGeoFromDirectIpApi()
  }
}

export async function detectClientGeo(): Promise<ClientGeoResult> {
  if (cachedGeoPromise) {
    return cachedGeoPromise
  }

  cachedGeoPromise = (async () => {
    const browserTimezone = detectTimezoneFromBrowser()
    const localeCountryCode = detectCountryCodeFromLocale()
    const browserLocationGeo = await detectGeoFromBrowserLocation()
    const ipGeo = await detectGeoFromPublicIp()

    return {
      countryCode: browserLocationGeo.countryCode || ipGeo.countryCode || localeCountryCode || "",
      country: browserLocationGeo.country || ipGeo.country || "",
      state: browserLocationGeo.state || ipGeo.state || "",
      stateCode: browserLocationGeo.stateCode || ipGeo.stateCode || "",
      timezone: browserTimezone || browserLocationGeo.timezone || ipGeo.timezone || "",
    }
  })()

  return cachedGeoPromise
}
