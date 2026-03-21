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
  entry30mEnabled?: boolean;
  entry1hEnabled?: boolean;
  entry4hEnabled?: boolean;
  useChgFilter?: boolean;
  chg30mEnabled?: boolean;
  chg1hEnabled?: boolean;
  chg4hEnabled?: boolean;
  chg30mMin?: number;
  chg30mMax?: number;
  chg1hMin?: number;
  chg1hMax?: number;
  chg4hMin?: number;
  chg4hMax?: number;
  dcaChg30mMin?: number;
  dcaChg30mMax?: number;
  dcaChg1hMin?: number;
  dcaChg1hMax?: number;
  dcaChg4hMin?: number;
  dcaChg4hMax?: number;
  chg30mExitBuffer?: number;
  chg1hExitBuffer?: number;
  chg4hExitBuffer?: number;
  dcaReentryMinProfit?: number;
  dcaReentryMaxDrawdown?: number;
  leverage?: number;
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
          entry_30m_enabled: Boolean(body.entry30mEnabled ?? false),
          entry_1h_enabled: Boolean(body.entry1hEnabled ?? false),
          entry_4h_enabled: Boolean(body.entry4hEnabled ?? false),
          use_chg_filter: Boolean(body.useChgFilter ?? true),
          chg_30m_enabled: Boolean(body.chg30mEnabled ?? true),
          chg_1h_enabled: Boolean(body.chg1hEnabled ?? true),
          chg_4h_enabled: Boolean(body.chg4hEnabled ?? true),
          chg_30m_min: Number(body.chg30mMin ?? -10),
          chg_30m_max: Number(body.chg30mMax ?? 10),
          chg_1h_min: Number(body.chg1hMin ?? -10),
          chg_1h_max: Number(body.chg1hMax ?? 10),
          chg_4h_min: Number(body.chg4hMin ?? -10),
          chg_4h_max: Number(body.chg4hMax ?? 10),
          dca_chg_30m_min: Number(body.dcaChg30mMin ?? -10),
          dca_chg_30m_max: Number(body.dcaChg30mMax ?? 10),
          dca_chg_1h_min: Number(body.dcaChg1hMin ?? -10),
          dca_chg_1h_max: Number(body.dcaChg1hMax ?? 10),
          dca_chg_4h_min: Number(body.dcaChg4hMin ?? -10),
          dca_chg_4h_max: Number(body.dcaChg4hMax ?? 10),
          chg_30m_exit_buffer: Number(body.chg30mExitBuffer ?? 2),
          chg_1h_exit_buffer: Number(body.chg1hExitBuffer ?? 2),
          chg_4h_exit_buffer: Number(body.chg4hExitBuffer ?? 2),
          dca_reentry_min_profit: Number(body.dcaReentryMinProfit ?? -0.05),
          dca_reentry_max_drawdown: Number(body.dcaReentryMaxDrawdown ?? -0.3),
          leverage: Number(body.leverage ?? 5),
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
