"use client"

import { useEffect, useState } from "react"

export function useCurrencyRealtime(): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const onCurrencyChanged = () => setTick((prev) => prev + 1)
    const onRatesUpdated = () => setTick((prev) => prev + 1)

    window.addEventListener("pp-currency-changed", onCurrencyChanged)
    window.addEventListener("pp-currency-rates-updated", onRatesUpdated)

    return () => {
      window.removeEventListener("pp-currency-changed", onCurrencyChanged)
      window.removeEventListener("pp-currency-rates-updated", onRatesUpdated)
    }
  }, [])

  return tick
}
