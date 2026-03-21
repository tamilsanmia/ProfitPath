const DEFAULT_CURRENCY = "USD"
const RATES_STORAGE_KEY = "pp_currency_rates_v1"
const RATES_TS_STORAGE_KEY = "pp_currency_rates_ts_v1"
const CURRENCY_STORAGE_KEY = "pp_currency"
const RATES_TTL_MS = 5 * 60 * 1000

type CurrencyRatesPayload = {
  rates: Record<string, number>
}

function canUseDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function normalizeCurrency(input?: string | null): string {
  const value = String(input ?? "").trim().toUpperCase()
  return value || DEFAULT_CURRENCY
}

function readStoredRates(): Record<string, number> {
  if (!canUseDom()) {
    return { USD: 1 }
  }

  const raw = window.localStorage.getItem(RATES_STORAGE_KEY)
  if (!raw) {
    return { USD: 1 }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    if (!parsed || typeof parsed !== "object") {
      return { USD: 1 }
    }
    return { USD: 1, ...parsed }
  } catch {
    return { USD: 1 }
  }
}

function writeStoredRates(rates: Record<string, number>): void {
  if (!canUseDom()) {
    return
  }

  window.localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(rates))
  window.localStorage.setItem(RATES_TS_STORAGE_KEY, String(Date.now()))
}

function getRatesAgeMs(): number {
  if (!canUseDom()) {
    return Number.POSITIVE_INFINITY
  }

  const raw = window.localStorage.getItem(RATES_TS_STORAGE_KEY)
  const ts = Number(raw)
  if (!Number.isFinite(ts)) {
    return Number.POSITIVE_INFINITY
  }

  return Date.now() - ts
}

export function getPreferredCurrency(): string {
  if (!canUseDom()) {
    return DEFAULT_CURRENCY
  }

  const attrCurrency = document.documentElement.getAttribute("data-currency")
  if (attrCurrency) {
    return normalizeCurrency(attrCurrency)
  }

  const storedCurrency = window.localStorage.getItem(CURRENCY_STORAGE_KEY)
  return normalizeCurrency(storedCurrency)
}

export function setPreferredCurrency(currency: string): void {
  if (!canUseDom()) {
    return
  }

  const normalized = normalizeCurrency(currency)
  document.documentElement.setAttribute("data-currency", normalized)
  window.localStorage.setItem(CURRENCY_STORAGE_KEY, normalized)
  window.dispatchEvent(new CustomEvent("pp-currency-changed", { detail: { currency: normalized } }))
}

export function getConversionRate(currency?: string): number {
  const normalized = normalizeCurrency(currency ?? getPreferredCurrency())
  const rates = readStoredRates()
  const rate = rates[normalized]

  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return 1
  }

  return rate
}

export function convertUsdToPreferred(amountUsd: number, currency?: string): number {
  return amountUsd * getConversionRate(currency)
}

export function formatCurrencyFromUsd(amountUsd: number, options?: { currency?: string; locale?: string }): string {
  const currency = normalizeCurrency(options?.currency ?? getPreferredCurrency())
  const locale = options?.locale ?? (canUseDom() ? document.documentElement.lang || "en-US" : "en-US")
  const converted = convertUsdToPreferred(amountUsd, currency)

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(converted)
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountUsd)
  }
}

export function formatCurrencyTextFromUsd(value: string): string {
  const raw = String(value ?? "").trim()
  const match = raw.match(/^([+-])?\s*\$?\s*([\d,]*\.?\d+)\s*([KMB])?$/i)
  if (!match) {
    return raw
  }

  const sign = match[1] === "-" ? -1 : 1
  const numeric = Number(match[2].replace(/,/g, ""))
  if (!Number.isFinite(numeric)) {
    return raw
  }

  const suffix = (match[3] || "").toUpperCase()
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1
  const amountUsd = numeric * multiplier * sign

  if (amountUsd < 0) {
    return `-${formatCurrencyFromUsd(Math.abs(amountUsd))}`
  }
  if (amountUsd > 0 && raw.startsWith("+")) {
    return `+${formatCurrencyFromUsd(amountUsd)}`
  }
  return formatCurrencyFromUsd(amountUsd)
}

let inFlightFetch: Promise<void> | null = null

export async function refreshCurrencyRates(force = false): Promise<void> {
  if (!canUseDom()) {
    return
  }

  if (!force && getRatesAgeMs() < RATES_TTL_MS) {
    return
  }

  if (inFlightFetch) {
    return inFlightFetch
  }

  inFlightFetch = (async () => {
    try {
      const response = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" })
      if (!response.ok) {
        return
      }

      const payload = (await response.json()) as CurrencyRatesPayload
      if (!payload?.rates || typeof payload.rates !== "object") {
        return
      }

      writeStoredRates({ USD: 1, ...payload.rates })
      window.dispatchEvent(new CustomEvent("pp-currency-rates-updated"))
    } catch {
      // Ignore rate fetch failures and keep last known rates.
    } finally {
      inFlightFetch = null
    }
  })()

  return inFlightFetch
}

export function initializeCurrencyRuntime(): void {
  if (!canUseDom()) {
    return
  }

  setPreferredCurrency(getPreferredCurrency())
  void refreshCurrencyRates(false)
}
