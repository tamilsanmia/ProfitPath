import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  email?: string;
};

type Params = {
  params: Promise<{ botId: string }>;
};

type SettingsBody = {
  tradeType?: string;
  dcaMode?: string;
  stakeAmount?: number | null;
  maxOpenOrder?: number;
  stoplossPct?: number;
  dcaStoplossPct?: number;
  leverage?: number;
  // DCA core
  maxDcaMultiplier?: number;
  maxDcaOrdersOpen?: number;
  initialEntryStakeRatio?: number;
  dcaEntryStakeRatio?: number;
  shiftLookback?: number;
  // Per-TF entry toggles
  entry5mLongEnabled?: boolean;
  entry5mShiftLongEnabled?: boolean;
  entry5mShortEnabled?: boolean;
  entry5mShiftShortEnabled?: boolean;
  entry15mLongEnabled?: boolean;
  entry15mShiftLongEnabled?: boolean;
  entry15mShortEnabled?: boolean;
  entry15mShiftShortEnabled?: boolean;
  entry30mLongEnabled?: boolean;
  entry30mShiftLongEnabled?: boolean;
  entry30mShortEnabled?: boolean;
  entry30mShiftShortEnabled?: boolean;
  entry1hLongEnabled?: boolean;
  entry1hShiftLongEnabled?: boolean;
  entry1hShortEnabled?: boolean;
  entry1hShiftShortEnabled?: boolean;
  entry4hLongEnabled?: boolean;
  entry4hShiftLongEnabled?: boolean;
  entry4hShortEnabled?: boolean;
  entry4hShiftShortEnabled?: boolean;
  // Per-TF RSI
  entry5mRsiLong?: number;
  entry5mRsiShort?: number;
  entry15mRsiLong?: number;
  entry15mRsiShort?: number;
  entry30mRsiLong?: number;
  entry30mRsiShort?: number;
  entry1hRsiLong?: number;
  entry1hRsiShort?: number;
  entry4hRsiLong?: number;
  entry4hRsiShort?: number;
  // Cross-TF RSI
  entry5mRsiLong15m?: number;
  entry5mRsiShort15m?: number;
  entry5mRsiLong30m?: number;
  entry5mRsiShort30m?: number;
  entry5mRsiLong1h?: number;
  entry5mRsiShort1h?: number;
  entry5mRsiLong4h?: number;
  entry5mRsiShort4h?: number;
  // CHG filter
  useChgFilter?: boolean;
  useChgExitBuffer?: boolean;
  chg5mEnabled?: boolean;
  chg5mMin?: number;
  chg5mMax?: number;
  dcaChg5mMin?: number;
  dcaChg5mMax?: number;
  chg5mExitBufferEnabled?: boolean;
  chg5mExitBuffer?: number;
  chg15mEnabled?: boolean;
  chg15mMin?: number;
  chg15mMax?: number;
  dcaChg15mMin?: number;
  dcaChg15mMax?: number;
  chg15mExitBufferEnabled?: boolean;
  chg15mExitBuffer?: number;
  chg30mEnabled?: boolean;
  chg30mMin?: number;
  chg30mMax?: number;
  dcaChg30mMin?: number;
  dcaChg30mMax?: number;
  chg30mExitBufferEnabled?: boolean;
  chg30mExitBuffer?: number;
  chg1hEnabled?: boolean;
  chg1hMin?: number;
  chg1hMax?: number;
  dcaChg1hMin?: number;
  dcaChg1hMax?: number;
  chg1hExitBufferEnabled?: boolean;
  chg1hExitBuffer?: number;
  chg4hEnabled?: boolean;
  chg4hMin?: number;
  chg4hMax?: number;
  dcaChg4hMin?: number;
  dcaChg4hMax?: number;
  chg4hExitBufferEnabled?: boolean;
  chg4hExitBuffer?: number;
  // DCA re-entry
  dcaReentryMinProfit?: number;
  dcaReentryMaxDrawdown?: number;
  dca2ReentryMinProfit?: number;
  dca2ReentryMaxDrawdown?: number;
  // Volatility guard
  dcaSuddenChgGuardEnabled?: boolean;
  dcaSuddenChgThreshold?: number;
  dcaSuddenChgLookback?: number;
  // Telegram
  telegramChgAlertEnabled?: boolean;
  telegramChgMin?: number;
  telegramChgMax?: number;
};

export async function PUT(request: Request, { params }: Params) {
  const { botId } = await params;

  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  const sessionToken = cookieStore.get("pp_session")?.value;

  if (!rawUser || !sessionToken) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let email = "";
  try {
    const user = JSON.parse(rawUser) as SessionUser;
    email = String(user?.email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid user session" }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: "Session email missing" }, { status: 400 });
  }

  let body: SettingsBody = {};
  try {
    body = (await request.json()) as SettingsBody;
  } catch {
    body = {};
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 seconds

    try {
      const response = await fetchBackend(`/subscriptions/${encodeURIComponent(botId)}/setup/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          session_token: sessionToken,
          trade_type: String(body.tradeType ?? "compound"),
          dca_mode: String(body.dcaMode ?? "Disable"),
          stake_amount: typeof body.stakeAmount === "number" ? body.stakeAmount : null,
          max_open_order: Number(body.maxOpenOrder ?? 15),
          stoploss_pct: Number(body.stoplossPct ?? 99),
          dca_stoploss_pct: Number(body.dcaStoplossPct ?? 50),
          leverage: Number(body.leverage ?? 5),
          // DCA core
          max_dca_multiplier: Number(body.maxDcaMultiplier ?? 1),
          max_dca_orders_open: Number(body.maxDcaOrdersOpen ?? 2),
          initial_entry_stake_ratio: Number(body.initialEntryStakeRatio ?? 0.5),
          dca_entry_stake_ratio: Number(body.dcaEntryStakeRatio ?? 0.5),
          shift_lookback: Number(body.shiftLookback ?? 5),
          // Per-TF entry toggles
          entry_5m_long_enabled: Boolean(body.entry5mLongEnabled ?? true),
          entry_5m_shift_long_enabled: Boolean(body.entry5mShiftLongEnabled ?? true),
          entry_5m_short_enabled: Boolean(body.entry5mShortEnabled ?? true),
          entry_5m_shift_short_enabled: Boolean(body.entry5mShiftShortEnabled ?? true),
          entry_15m_long_enabled: Boolean(body.entry15mLongEnabled ?? false),
          entry_15m_shift_long_enabled: Boolean(body.entry15mShiftLongEnabled ?? false),
          entry_15m_short_enabled: Boolean(body.entry15mShortEnabled ?? false),
          entry_15m_shift_short_enabled: Boolean(body.entry15mShiftShortEnabled ?? false),
          entry_30m_long_enabled: Boolean(body.entry30mLongEnabled ?? false),
          entry_30m_shift_long_enabled: Boolean(body.entry30mShiftLongEnabled ?? false),
          entry_30m_short_enabled: Boolean(body.entry30mShortEnabled ?? false),
          entry_30m_shift_short_enabled: Boolean(body.entry30mShiftShortEnabled ?? false),
          entry_1h_long_enabled: Boolean(body.entry1hLongEnabled ?? false),
          entry_1h_shift_long_enabled: Boolean(body.entry1hShiftLongEnabled ?? false),
          entry_1h_short_enabled: Boolean(body.entry1hShortEnabled ?? false),
          entry_1h_shift_short_enabled: Boolean(body.entry1hShiftShortEnabled ?? false),
          entry_4h_long_enabled: Boolean(body.entry4hLongEnabled ?? false),
          entry_4h_shift_long_enabled: Boolean(body.entry4hShiftLongEnabled ?? false),
          entry_4h_short_enabled: Boolean(body.entry4hShortEnabled ?? false),
          entry_4h_shift_short_enabled: Boolean(body.entry4hShiftShortEnabled ?? false),
          // Per-TF RSI
          entry_5m_rsi_long: Number(body.entry5mRsiLong ?? 30),
          entry_5m_rsi_short: Number(body.entry5mRsiShort ?? 70),
          entry_15m_rsi_long: Number(body.entry15mRsiLong ?? 30),
          entry_15m_rsi_short: Number(body.entry15mRsiShort ?? 70),
          entry_30m_rsi_long: Number(body.entry30mRsiLong ?? 30),
          entry_30m_rsi_short: Number(body.entry30mRsiShort ?? 70),
          entry_1h_rsi_long: Number(body.entry1hRsiLong ?? 30),
          entry_1h_rsi_short: Number(body.entry1hRsiShort ?? 70),
          entry_4h_rsi_long: Number(body.entry4hRsiLong ?? 30),
          entry_4h_rsi_short: Number(body.entry4hRsiShort ?? 70),
          // Cross-TF RSI
          entry_5m_rsi_long_15m: Number(body.entry5mRsiLong15m ?? 30),
          entry_5m_rsi_short_15m: Number(body.entry5mRsiShort15m ?? 70),
          entry_5m_rsi_long_30m: Number(body.entry5mRsiLong30m ?? 40),
          entry_5m_rsi_short_30m: Number(body.entry5mRsiShort30m ?? 60),
          entry_5m_rsi_long_1h: Number(body.entry5mRsiLong1h ?? 40),
          entry_5m_rsi_short_1h: Number(body.entry5mRsiShort1h ?? 60),
          entry_5m_rsi_long_4h: Number(body.entry5mRsiLong4h ?? 40),
          entry_5m_rsi_short_4h: Number(body.entry5mRsiShort4h ?? 60),
          // CHG filter
          use_chg_filter: Boolean(body.useChgFilter ?? true),
          use_chg_exit_buffer: Boolean(body.useChgExitBuffer ?? true),
          chg_5m_enabled: Boolean(body.chg5mEnabled ?? true),
          chg_5m_min: Number(body.chg5mMin ?? -10),
          chg_5m_max: Number(body.chg5mMax ?? 10),
          dca_chg_5m_min: Number(body.dcaChg5mMin ?? -10),
          dca_chg_5m_max: Number(body.dcaChg5mMax ?? 10),
          chg_5m_exit_buffer_enabled: Boolean(body.chg5mExitBufferEnabled ?? true),
          chg_5m_exit_buffer: Number(body.chg5mExitBuffer ?? 2),
          chg_15m_enabled: Boolean(body.chg15mEnabled ?? true),
          chg_15m_min: Number(body.chg15mMin ?? -10),
          chg_15m_max: Number(body.chg15mMax ?? 10),
          dca_chg_15m_min: Number(body.dcaChg15mMin ?? -10),
          dca_chg_15m_max: Number(body.dcaChg15mMax ?? 10),
          chg_15m_exit_buffer_enabled: Boolean(body.chg15mExitBufferEnabled ?? true),
          chg_15m_exit_buffer: Number(body.chg15mExitBuffer ?? 2),
          chg_30m_enabled: Boolean(body.chg30mEnabled ?? true),
          chg_30m_min: Number(body.chg30mMin ?? -10),
          chg_30m_max: Number(body.chg30mMax ?? 10),
          dca_chg_30m_min: Number(body.dcaChg30mMin ?? -10),
          dca_chg_30m_max: Number(body.dcaChg30mMax ?? 10),
          chg_30m_exit_buffer_enabled: Boolean(body.chg30mExitBufferEnabled ?? true),
          chg_30m_exit_buffer: Number(body.chg30mExitBuffer ?? 2),
          chg_1h_enabled: Boolean(body.chg1hEnabled ?? true),
          chg_1h_min: Number(body.chg1hMin ?? -10),
          chg_1h_max: Number(body.chg1hMax ?? 10),
          dca_chg_1h_min: Number(body.dcaChg1hMin ?? -10),
          dca_chg_1h_max: Number(body.dcaChg1hMax ?? 10),
          chg_1h_exit_buffer_enabled: Boolean(body.chg1hExitBufferEnabled ?? true),
          chg_1h_exit_buffer: Number(body.chg1hExitBuffer ?? 2),
          chg_4h_enabled: Boolean(body.chg4hEnabled ?? true),
          chg_4h_min: Number(body.chg4hMin ?? -10),
          chg_4h_max: Number(body.chg4hMax ?? 10),
          dca_chg_4h_min: Number(body.dcaChg4hMin ?? -10),
          dca_chg_4h_max: Number(body.dcaChg4hMax ?? 10),
          chg_4h_exit_buffer_enabled: Boolean(body.chg4hExitBufferEnabled ?? true),
          chg_4h_exit_buffer: Number(body.chg4hExitBuffer ?? 2),
          // DCA re-entry
          dca_reentry_min_profit: Number(body.dcaReentryMinProfit ?? -0.15),
          dca_reentry_max_drawdown: Number(body.dcaReentryMaxDrawdown ?? -0.5),
          dca2_reentry_min_profit: Number(body.dca2ReentryMinProfit ?? -0.30),
          dca2_reentry_max_drawdown: Number(body.dca2ReentryMaxDrawdown ?? -0.5),
          // Volatility guard
          dca_sudden_chg_guard_enabled: Boolean(body.dcaSuddenChgGuardEnabled ?? true),
          dca_sudden_chg_threshold: Number(body.dcaSuddenChgThreshold ?? 5.0),
          dca_sudden_chg_lookback: Number(body.dcaSuddenChgLookback ?? 10),
          // Telegram
          telegram_chg_alert_enabled: Boolean(body.telegramChgAlertEnabled ?? true),
          telegram_chg_min: Number(body.telegramChgMin ?? -5),
          telegram_chg_max: Number(body.telegramChgMax ?? 5),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const raw = await response.text();
      let payload: Record<string, unknown>;
      try {
        payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        payload = { error: raw || "Backend returned a non-JSON response" };
      }

      if (!response.ok) {
        const detail = String(payload.detail ?? payload.error ?? payload.message ?? "Failed to save bot settings");
        return NextResponse.json({ error: detail, detail }, { status: response.status });
      }

      return NextResponse.json(payload, { status: response.status });
    } catch (err) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : "Failed to save bot settings";
      if (message.includes("abort")) {
        return NextResponse.json({ error: "Request timeout (90s)" }, { status: 504 });
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
