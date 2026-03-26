"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrencyFromUsd } from "@/lib/currency-runtime";
import { useCurrencyRealtime } from "@/hooks/use-currency-realtime";
import { Slider } from "@/components/ui/slider";

const EXCHANGES = ["binance", "bybit"] as const;
const TRADE_TYPES = ["Fixed", "Compound"] as const;
const DCA_OPTIONS = ["Enable", "Disable"] as const;
const RECOMMENDED_EXCHANGE = "binance" as const;
const RECOMMENDED_CAPITAL = 1000;
const RECOMMENDED_TRADE_TYPE = "Compound" as const;
const RECOMMENDED_DCA_MODE = "Enable" as const;
const RECOMMENDED_STAKE_AMOUNT = 100;
const RECOMMENDED_MAX_OPEN_ORDER = 30;
const CAPITAL_MIN = 100;
const CAPITAL_MAX = 10000;
const CAPITAL_STEP = 100;
const BILLING_CYCLES = ["30 Days", "90 Days"] as const;
const MONTHLY_SERVER_FEE = 10;
const LEVERAGE_OPTIONS = ["5x", "7x", "10x", "15x"] as const;
const RECOMMENDED_LEVERAGE = "5x" as const;
const TIMEFRAMES = ["30m", "1h", "4h"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const RECOMMENDED_TIMEFRAMES: readonly Timeframe[] = ["1h", "4h"];

// ─── Helper ─────────────────────────────────────────────────────────────────
function usd(n: number, noSign = false) {
  const abs = Math.abs(n);
  const fmt = formatCurrencyFromUsd(abs);
  if (noSign) return fmt;
  if (n < 0) return `-${fmt}`;
  if (n > 0) return `+${fmt}`;
  return fmt;
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function Section({ title, sub, children, dataName }: { title: string; sub: string; children: React.ReactNode; dataName?: string }) {
  return (
    <div data-name={dataName}>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mb-3 mt-0.5 text-xs text-slate-400">{sub}</p>
      {children}
    </div>
  );
}

function Radio({
  label, sublabel, badge, extra, badgeBlue, selected, onClick,
}: {
  label: string; sublabel?: string; badge?: string | null;
  extra?: number; badgeBlue?: boolean; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        selected
          ? "border-blue-500 bg-blue-500/10"
          : "border-[#1e3a5f] bg-[#0b1628] hover:border-[#2a4f7f]"
      }`}
    >
      {/* dot */}
      <span
        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? "border-blue-500 bg-blue-500" : "border-slate-600"
        }`}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      {/* content */}
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-white">{label}</span>
          {badge && (
            <span
              className={`rounded-full border px-2 py-0.5 text-xs ${
                badgeBlue
                  ? "border-blue-500/40 bg-blue-500/20 text-blue-300"
                  : "border-slate-600 text-slate-400"
              }`}
            >
              {badge}
            </span>
          )}
          {extra !== undefined && extra !== 0 && (
            <span className="ml-auto text-xs text-slate-400">{usd(extra)}</span>
          )}
        </span>
        {sublabel && <span className="text-xs text-blue-400">{sublabel}</span>}
      </span>
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export function SubscriptionInterface() {
  useCurrencyRealtime();

  const router = useRouter();
  const [exchange, setExchange] = useState<(typeof EXCHANGES)[number]>(RECOMMENDED_EXCHANGE);
  const [tradeType, setTradeType] = useState<(typeof TRADE_TYPES)[number]>(RECOMMENDED_TRADE_TYPE);
  const [dcaMode, setDcaMode] = useState<(typeof DCA_OPTIONS)[number]>(RECOMMENDED_DCA_MODE);
  const [capital, setCapital] = useState<number>(RECOMMENDED_CAPITAL);
  const [stakeAmount, setStakeAmount] = useState<number>(RECOMMENDED_STAKE_AMOUNT);
  const [maxOpenOrder, setMaxOpenOrder] = useState<number>(RECOMMENDED_MAX_OPEN_ORDER);
  const stakeAmountMax = Math.min(1000, capital);
  const [billingCycle, setBillingCycle] = useState<(typeof BILLING_CYCLES)[number]>("30 Days");
  // Stoploss
  const [stoploss, setStoploss] = useState<number>(99);
  const [dcaStoploss, setDcaStoploss] = useState<number>(50);
  // Leverage
  const [leverage, setLeverage] = useState<(typeof LEVERAGE_OPTIONS)[number]>(RECOMMENDED_LEVERAGE);
  // Entry Timeframes
  const [enabledTimeframes, setEnabledTimeframes] = useState<Set<Timeframe>>(new Set(RECOMMENDED_TIMEFRAMES));
  const toggleTimeframe = (tf: Timeframe) => setEnabledTimeframes(prev => { const s = new Set(prev); s.has(tf) ? s.delete(tf) : s.add(tf); return s; });
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [provisioningPopupOpen, setProvisioningPopupOpen] = useState(false);
  const [provisioningComplete, setProvisioningComplete] = useState(false);
  const [provisioningBotId, setProvisioningBotId] = useState<string | null>(null);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);

  useEffect(() => {
    if (tradeType !== "Fixed") {
      setStakeAmount(RECOMMENDED_STAKE_AMOUNT);
    }
  }, [tradeType]);

  useEffect(() => {
    setStakeAmount((prev) => Math.min(prev, stakeAmountMax));
  }, [stakeAmountMax]);

  const setupCharge = 0;
  const monthlyServerFee = MONTHLY_SERVER_FEE;

  const totalToday = setupCharge + monthlyServerFee;
  const billingCycleDays = billingCycle === "90 Days" ? 90 : 30;

  const handleActivateBot = async () => {
    if (!agreed || isSubmitting) return;

    if (tradeType === "Fixed" && stakeAmount <= 0) {
      setSubmitError("Please enter a valid stake amount for Fixed trade type.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitMessage(null);
    setProvisioningPopupOpen(true);
    setProvisioningComplete(false);
    setProvisioningBotId(null);
    setProvisioningError(null);

    try {
      const response = await fetch("/api/subscription/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          model: tradeType,
          trade_type: tradeType,
          dca_mode: dcaMode,
          stake_amount: tradeType === "Fixed" ? stakeAmount : null,
          max_open_order: maxOpenOrder,
          capital_usdt: capital,
          billing_cycle_days: billingCycleDays,
          stoploss_pct: stoploss,
          dca_stoploss_pct: dcaStoploss,
          leverage: leverage,
          entry_timeframes: [...enabledTimeframes],
          setup_charge_usd: setupCharge,
          monthly_server_fee_usd: monthlyServerFee,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string; detail?: string; bot?: { id?: string } };
      if (!response.ok) {
        throw new Error(payload.error || payload.detail || payload.message || "Payment completion failed");
      }

      setSubmitMessage(payload.message || "Payment done. Redirecting to My Bots...");
      setProvisioningBotId(payload.bot?.id || null);
      setProvisioningComplete(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to complete payment";
      setSubmitError(message);
      setProvisioningError(message);
      setProvisioningComplete(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewBotDetails = () => {
    const nextUrl = provisioningBotId
      ? `/my-bots?payment=done&bot=${encodeURIComponent(provisioningBotId)}`
      : "/my-bots?payment=done";
    router.push(nextUrl);
  };

  return (
    <div data-name="subscription-interface" className="min-h-screen text-white">
      <div data-name="subscription-container" className="mx-auto max-w-7xl space-y-8 px-0 py-6">

        {/* ── Header ── */}
        <div data-name="subscription-header" className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1e293b] text-sm font-bold text-blue-400">
            FP
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">New Bot</h1>
            <p className="text-xs text-slate-400">Bot Setup</p>
          </div>
        </div>

        <div data-name="subscription-content-grid" className="grid gap-8 lg:grid-cols-[1fr_370px]">

          {/* ─────────── LEFT: Options ─────────── */}
          <div data-name="subscription-form-sections" className="space-y-7">

            <Section dataName="subscription-section-exchange" title="1. Select Exchange" sub="Binance or Bybit">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {EXCHANGES.map(item => (
                  <Radio
                    key={item}
                    label={item === "binance" ? "Binance" : "Bybit"}
                    badge={item === RECOMMENDED_EXCHANGE ? "Recommended" : null}
                    badgeBlue={item === RECOMMENDED_EXCHANGE}
                    selected={exchange === item}
                    onClick={() => setExchange(item)}
                  />
                ))}
              </div>
            </Section>

            <Section dataName="subscription-section-capital" title="2. Select Capital (USDT)" sub="Choose your starting capital">
              <div className="rounded-xl border border-[#1e3a5f] bg-[#0b1628] p-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs text-slate-400">Select Capital (USDT)</label>
                  <div className="flex items-center gap-2">
                    {capital === RECOMMENDED_CAPITAL && (
                      <span className="rounded-full border border-blue-500/40 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">
                        Recommended
                      </span>
                    )}
                    <span className="text-sm font-semibold text-white">{usd(capital, true)} USDT</span>
                  </div>
                </div>
                <Slider
                  min={CAPITAL_MIN}
                  max={CAPITAL_MAX}
                  step={CAPITAL_STEP}
                  value={[capital]}
                  onValueChange={([v]) => setCapital(v)}
                  className="[&_[role=slider]]:h-5 [&_[role=slider]]:w-5 [&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-[#0b1628] [&_.relative]:h-2 [&_.absolute]:bg-blue-500 [&_.relative]:bg-[#1e3a5f]"
                />
                <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                  <span>{CAPITAL_MIN.toLocaleString()}</span>
                  <span>{CAPITAL_MAX.toLocaleString()}</span>
                </div>
              </div>
            </Section>

            <Section dataName="subscription-section-trade-type" title="3. Trade Type" sub="Choose Fixed or Compound, Stake Amount, DCA Mode, Max Open Order">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs text-slate-400">Trade Type</label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {TRADE_TYPES.map(item => (
                      <Radio
                        key={item}
                        label={item}
                        badge={item === RECOMMENDED_TRADE_TYPE ? "Recommended" : null}
                        badgeBlue={item === RECOMMENDED_TRADE_TYPE}
                        selected={tradeType === item}
                        onClick={() => setTradeType(item)}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs text-slate-400">DCA Mode</label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {DCA_OPTIONS.map(item => (
                      <Radio
                        key={item}
                        label={item}
                        badge={item === RECOMMENDED_DCA_MODE ? "Recommended" : null}
                        badgeBlue={item === RECOMMENDED_DCA_MODE}
                        selected={dcaMode === item}
                        onClick={() => setDcaMode(item)}
                      />
                    ))}
                  </div>
                </div>

                {tradeType === "Fixed" && (
                  <div className="rounded-xl border border-[#1e3a5f] bg-[#0b1628] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <label className="text-xs text-slate-400">Stake Amount (USDT)</label>
                      <div className="flex items-center gap-2">
                        {stakeAmount === RECOMMENDED_STAKE_AMOUNT && (
                          <span className="rounded-full border border-blue-500/40 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">
                            Recommended
                          </span>
                        )}
                        <span className="text-sm font-semibold text-white">{usd(stakeAmount, true)} USDT</span>
                      </div>
                    </div>
                    <Slider
                      min={1}
                      max={stakeAmountMax}
                      step={1}
                      value={[stakeAmount]}
                      onValueChange={([v]) => setStakeAmount(v)}
                      className="[&_[role=slider]]:h-5 [&_[role=slider]]:w-5 [&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-[#0b1628] [&_.relative]:h-2 [&_.absolute]:bg-blue-500 [&_.relative]:bg-[#1e3a5f]"
                    />
                    <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                      <span>1</span>
                      <span>{stakeAmountMax.toLocaleString()}</span>
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-[#1e3a5f] bg-[#0b1628] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs text-slate-400">Max Open Order</label>
                    <div className="flex items-center gap-2">
                      {maxOpenOrder === RECOMMENDED_MAX_OPEN_ORDER && (
                        <span className="rounded-full border border-blue-500/40 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">
                          Recommended
                        </span>
                      )}
                      <span className="text-sm font-semibold text-white">{maxOpenOrder}</span>
                    </div>
                  </div>
                  <Slider
                    min={5}
                    max={30}
                    step={1}
                    value={[maxOpenOrder]}
                    onValueChange={([v]) => setMaxOpenOrder(v)}
                    className="[&_[role=slider]]:h-5 [&_[role=slider]]:w-5 [&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-[#0b1628] [&_.relative]:h-2 [&_.absolute]:bg-blue-500 [&_.relative]:bg-[#1e3a5f]"
                  />
                  <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                    <span>5</span>
                    <span>30</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">Max Open Order 30 is less profitable but more stable for compound trading.</p>
                </div>
              </div>
            </Section>

            <Section dataName="subscription-section-stoploss" title="4. Stoploss Settings" sub="Configure stoploss percentages">
              <div className="space-y-4">
                {/* Stoploss */}
                <div className="rounded-xl border border-[#1e3a5f] bg-[#0b1628] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs text-slate-400">Stoploss %</label>
                    <div className="flex items-center gap-2">
                      {stoploss === 99 && <span className="rounded-full border border-blue-500/40 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">Recommended</span>}
                      <span className="text-sm font-semibold text-white">{stoploss}%</span>
                    </div>
                  </div>
                  <Slider min={1} max={100} step={1} value={[stoploss]} onValueChange={([v]) => setStoploss(v)}
                    className="[&_[role=slider]]:h-5 [&_[role=slider]]:w-5 [&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-[#0b1628] [&_.relative]:h-2 [&_.absolute]:bg-blue-500 [&_.relative]:bg-[#1e3a5f]"
                  />
                  <div className="flex items-center justify-between mt-2 text-xs text-slate-500"><span>1%</span><span>100%</span></div>
                </div>
                {/* DCA Stoploss */}
                <div className="rounded-xl border border-[#1e3a5f] bg-[#0b1628] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs text-slate-400">DCA Stoploss %</label>
                    <div className="flex items-center gap-2">
                      {dcaStoploss === 50 && <span className="rounded-full border border-blue-500/40 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">Recommended</span>}
                      <span className="text-sm font-semibold text-white">{dcaStoploss}%</span>
                    </div>
                  </div>
                  <Slider min={1} max={100} step={1} value={[dcaStoploss]} onValueChange={([v]) => setDcaStoploss(v)}
                    className="[&_[role=slider]]:h-5 [&_[role=slider]]:w-5 [&_[role=slider]]:border-blue-500 [&_[role=slider]]:bg-[#0b1628] [&_.relative]:h-2 [&_.absolute]:bg-blue-500 [&_.relative]:bg-[#1e3a5f]"
                  />
                  <div className="flex items-center justify-between mt-2 text-xs text-slate-500"><span>1%</span><span>100%</span></div>
                </div>
              </div>
            </Section>

            <Section dataName="subscription-section-leverage" title="5. Leverage" sub="Select your trading leverage">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {LEVERAGE_OPTIONS.map(item => (
                  <Radio
                    key={item}
                    label={item}
                    badge={item === RECOMMENDED_LEVERAGE ? "Recommended" : null}
                    badgeBlue={item === RECOMMENDED_LEVERAGE}
                    selected={leverage === item}
                    onClick={() => setLeverage(item)}
                  />
                ))}
              </div>
            </Section>

            <Section dataName="subscription-section-timeframes" title="6. Entry Timeframes" sub="Recommended: 1h and 4h for stable performance">
              <div className="space-y-3">
                {TIMEFRAMES.map(tf => {
                  const on = enabledTimeframes.has(tf);
                  const rec = RECOMMENDED_TIMEFRAMES.includes(tf);
                  return (
                    <div key={tf} className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${on ? "border-blue-500 bg-blue-500/10" : "border-[#1e3a5f] bg-[#0b1628]"}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{tf}</span>
                        {rec && <span className="rounded-full border border-blue-500/40 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">Recommended</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleTimeframe(tf)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${on ? "bg-blue-500" : "bg-slate-700"}`}
                        aria-checked={on}
                        role="switch"
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${on ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section dataName="subscription-section-billing-cycle" title="7. Profit Share Billing Cycle" sub="Choose billing interval">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {BILLING_CYCLES.map(item => (
                  <Radio key={item} label={item} selected={billingCycle === item} onClick={() => setBillingCycle(item)} />
                ))}
              </div>
            </Section>
          </div>

          {/* ─────────── RIGHT: Sidebar ─────────── */}
          <div data-name="subscription-sidebar" className="space-y-4">
            <div data-name="subscription-order-summary" className="rounded-xl border border-[#1e3a5f] bg-[#0b1628] px-5 py-5">
              <p className="mb-4 text-base font-semibold text-white">Order Summary</p>

              <div className="space-y-2 text-sm text-slate-300">
                <div className="flex justify-between gap-3">
                  <span>Exchange</span>
                  <span className="font-medium text-white">{exchange === "binance" ? "Binance" : "Bybit"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Trade Type</span>
                  <span className="font-medium text-white">{tradeType}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>DCA Mode</span>
                  <span className="font-medium text-white">{dcaMode}</span>
                </div>
                {tradeType === "Fixed" && (
                  <div className="flex justify-between gap-3">
                    <span>Stake Amount</span>
                    <span className="font-medium text-white">{usd(stakeAmount, true)} USDT</span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span>Capital</span>
                  <span className="font-medium text-white">{usd(capital, true)} USDT</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Max Open Order</span>
                  <span className="font-medium text-white">{maxOpenOrder}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Stoploss</span>
                  <span className="font-medium text-white">{stoploss}%</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>DCA Stoploss</span>
                  <span className="font-medium text-white">{dcaStoploss}%</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Leverage</span>
                  <span className="font-medium text-white">{leverage}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Timeframes</span>
                  <span className="font-medium text-white">{enabledTimeframes.size > 0 ? [...enabledTimeframes].join(", ") : "None"}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Profit Share Billing Cycle</span>
                  <span className="font-medium text-white">{billingCycle}</span>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[#1e3a5f] pt-4">
                <span className="text-sm text-slate-300">Setup Charge (one-time)</span>
                <span className="font-semibold text-white">{usd(setupCharge, true)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-slate-300">Server Fee (monthly)</span>
                <span className="font-semibold text-white">{usd(monthlyServerFee, true)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-[#1e3a5f] pt-3">
                <span className="font-semibold text-white">Due Today</span>
                <span className="text-xl font-bold text-white">{usd(totalToday, true)}</span>
              </div>

              <p className="mt-2 text-xs text-slate-400">Every month, {usd(monthlyServerFee, true)} will be charged for server usage.</p>

              <div className="mt-5">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 cursor-pointer accent-blue-500"
                  />
                  <span className="text-xs text-slate-300">
                    I agree with <span className="font-semibold text-white">all</span> the following terms:
                  </span>
                </label>
                <ul className="ml-7 mt-2 list-disc space-y-1.5 text-xs text-slate-400">
                  <li>I understand the setup charge is one-time.</li>
                  <li>I accept recurring monthly server charge of {usd(monthlyServerFee, true)}.</li>
                  <li>I agree with the <span className="cursor-pointer text-blue-400 underline">Terms &amp; Conditions</span>.</li>
                </ul>
              </div>

              <button
                type="button"
                onClick={handleActivateBot}
                disabled={!agreed || isSubmitting}
                className="mt-5 w-full rounded-xl bg-[#4a67ff] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5771ff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting ? "Processing Payment..." : "Continue to Payment"}
              </button>

              {submitMessage && <p className="mt-2 text-xs text-emerald-400">{submitMessage}</p>}
              {submitError && <p className="mt-2 text-xs text-red-400">{submitError}</p>}
            </div>
          </div>
        </div>
      </div>

      {provisioningPopupOpen && (
        <div data-name="subscription-provisioning-popup" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 px-4 pb-6 sm:pb-10">
          <div className="w-full max-w-md rounded-2xl border border-[#1e3a5f] bg-[#0b1628] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            {!provisioningComplete && !provisioningError && (
              <div className="space-y-4 text-center">
                <p className="text-base font-semibold text-white">Payment Completed</p>
                <p className="text-sm text-slate-300">Creating your server and deploying bot in demo mode...</p>
                <p className="text-xs text-slate-400">Please wait a few mins while we complete the setup.</p>
                <div className="flex items-center justify-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
                  <span className="text-sm text-blue-200">Server creation in progress</span>
                </div>
              </div>
            )}

            {provisioningComplete && !provisioningError && (
              <div className="space-y-4">
                <p className="text-base font-semibold text-emerald-300">Server Created And Bot Deployed</p>
                <p className="text-sm text-slate-300">Your bot is ready in demo mode. You can now open bot details.</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleViewBotDetails}
                    className="w-full rounded-xl bg-[#4a67ff] py-2.5 text-sm font-semibold text-white hover:bg-[#5771ff]"
                  >
                    View Bot Details
                  </button>
                  <button
                    type="button"
                    onClick={() => setProvisioningPopupOpen(false)}
                    className="rounded-xl border border-[#2a4f7f] px-4 py-2.5 text-sm text-slate-200 hover:border-blue-400"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {provisioningError && (
              <div className="space-y-4">
                <p className="text-base font-semibold text-red-300">Provisioning Failed</p>
                <p className="text-sm text-red-200/90">{provisioningError}</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleViewBotDetails}
                    className="w-full rounded-xl bg-[#4a67ff] py-2.5 text-sm font-semibold text-white hover:bg-[#5771ff]"
                  >
                    Go To My Bots
                  </button>
                  <button
                    type="button"
                    onClick={() => setProvisioningPopupOpen(false)}
                    className="rounded-xl border border-[#2a4f7f] px-4 py-2.5 text-sm text-slate-200 hover:border-blue-400"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
