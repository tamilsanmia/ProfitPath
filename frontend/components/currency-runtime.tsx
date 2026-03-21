"use client"

import { useEffect } from "react"
import { initializeCurrencyRuntime, refreshCurrencyRates } from "@/lib/currency-runtime"

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export default function CurrencyRuntime() {
  useEffect(() => {
    initializeCurrencyRuntime()

    const interval = window.setInterval(() => {
      void refreshCurrencyRates(true)
    }, REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  return null
}
