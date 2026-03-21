"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrencyFromUsd } from "@/lib/currency-runtime";
import { useCurrencyRealtime } from "@/hooks/use-currency-realtime";

const EXCHANGES = ["binance", "bybit"] as const;
const TRADE_TYPES = ["Fixed", "Compound"] as const;
const DCA_OPTIONS = ["Enable", "Disable"] as const;
const CAPITALS = [1000, 5000, 10000] as const;
const BILLING_CYCLES = ["30 Days", "90 Days"] as const;
const MONTHLY_SERVER_FEE = 10;

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
  const [exchange, setExchange] = useState<(typeof EXCHANGES)[number]>("binance");
  const [tradeType, setTradeType] = useState<(typeof TRADE_TYPES)[number]>("Fixed");
  const [dcaMode, setDcaMode] = useState<(typeof DCA_OPTIONS)[number]>("Enable");
  const [capital, setCapital] = useState<(typeof CAPITALS)[number]>(1000);
  const [stakeAmount, setStakeAmount] = useState<string>("");
  const [maxOpenOrder, setMaxOpenOrder] = useState<number>(5);
  const [billingCycle, setBillingCycle] = useState<(typeof BILLING_CYCLES)[number]>("30 Days");
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
      setStakeAmount("");
    }
  }, [tradeType]);

  const setupCharge = 0;
  const monthlyServerFee = MONTHLY_SERVER_FEE;

  const totalToday = setupCharge + monthlyServerFee;
  const billingCycleDays = billingCycle === "90 Days" ? 90 : 30;

  const handleActivateBot = async () => {
    if (!agreed || isSubmitting) return;

    if (tradeType === "Fixed") {
      const parsedStake = Number(stakeAmount);
      if (!Number.isFinite(parsedStake) || parsedStake <= 0) {
        setSubmitError("Please enter a valid stake amount for Fixed trade type.");
        return;
      }
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
          stake_amount: tradeType === "Fixed" ? Number(stakeAmount || 0) : null,
          max_open_order: maxOpenOrder,
          capital_usdt: capital,
          billing_cycle_days: billingCycleDays,
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
            <h1 className="text-2xl font-bold text-white">Bot Subscription</h1>
            <p className="text-xs text-slate-400">New Bot</p>
          </div>
        </div>

        <div data-name="subscription-content-grid" className="grid gap-8 lg:grid-cols-[1fr_370px]">

          {/* ─────────── LEFT: Options ─────────── */}
          <div data-name="subscription-form-sections" className="space-y-7">

            <Section dataName="subscription-section-exchange" title="1. Select Exchange" sub="Binance or Bybit">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {EXCHANGES.map(item => (
                  <Radio key={item} label={item === "binance" ? "Binance" : "Bybit"} selected={exchange === item} onClick={() => setExchange(item)} />
                ))}
              </div>
            </Section>

            <Section dataName="subscription-section-capital" title="2. Select Capital (USDT)" sub="Choose your starting capital">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {CAPITALS.map(item => (
                  <Radio key={item} label={`${usd(item, true)} USDT`} selected={capital === item} onClick={() => setCapital(item)} />
                ))}
              </div>
            </Section>

            <Section dataName="subscription-section-trade-type" title="3. Trade Type" sub="Choose Fixed or Compound, Stake Amount, DCA Mode, Max Open Order">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs text-slate-400">Trade Type</label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {TRADE_TYPES.map(item => (
                      <Radio key={item} label={item} selected={tradeType === item} onClick={() => setTradeType(item)} />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs text-slate-400">DCA Mode</label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {DCA_OPTIONS.map(item => (
                      <Radio key={item} label={item} selected={dcaMode === item} onClick={() => setDcaMode(item)} />
                    ))}
                  </div>
                </div>

                {tradeType === "Fixed" && (
                  <div className="rounded-xl border border-[#1e3a5f] bg-[#0b1628] p-4">
                    <label className="mb-2 block text-xs text-slate-400">Stake Amount (USDT)</label>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={stakeAmount}
                      onChange={e => setStakeAmount(e.target.value)}
                      className="w-full rounded-lg border border-[#2a4f7f] bg-[#071224] px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                      placeholder="Enter stake amount"
                    />
                  </div>
                )}

                <div className="rounded-xl border border-[#1e3a5f] bg-[#0b1628] p-4">
                  <label className="mb-2 block text-xs text-slate-400">Max Open Order</label>
                  <input
                    type="number"
                    min="5"
                    max="15"
                    step="1"
                    value={maxOpenOrder}
                    onChange={e => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      setMaxOpenOrder(Math.min(15, Math.max(5, Math.trunc(next))));
                    }}
                    className="w-full rounded-lg border border-[#2a4f7f] bg-[#071224] px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </Section>

            <Section dataName="subscription-section-billing-cycle" title="4. Profit Share Billing Cycle" sub="Choose billing interval">
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
                    <span className="font-medium text-white">{stakeAmount ? `${usd(Number(stakeAmount), true)} USDT` : "Not set"}</span>
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
        <div data-name="subscription-provisioning-popup" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-[#1e3a5f] bg-[#0b1628] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
            {!provisioningComplete && !provisioningError && (
              <div className="space-y-4">
                <p className="text-base font-semibold text-white">Payment Completed</p>
                <p className="text-sm text-slate-300">Creating your server and deploying bot in demo mode...</p>
                <div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
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
