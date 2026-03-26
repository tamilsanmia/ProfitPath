import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  email?: string;
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  const sessionToken = cookieStore.get("pp_session")?.value;

  if (!rawUser || !sessionToken) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let userEmail = "";
  try {
    const user = JSON.parse(rawUser) as SessionUser;
    userEmail = String(user?.email || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid session user" }, { status: 400 });
  }

  if (!userEmail) {
    return NextResponse.json({ error: "Session email missing" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const res = await fetchBackend("/subscriptions/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userEmail,
        session_token: sessionToken,
        account_type: body?.account_type,
        exchange: body?.exchange,
        model: body?.model,
        trade_type: body?.trade_type,
        dca_mode: body?.dca_mode,
        strategy_name: body?.strategy_name,
        stake_amount: body?.stake_amount,
        max_open_order: Number(body?.max_open_order ?? 15),
        capital_usdt: Number(body?.capital_usdt ?? 0),
        billing_cycle_days: Number(body?.billing_cycle_days ?? 30),
        setup_charge_usd: Number(body?.setup_charge_usd ?? 0),
        monthly_server_fee_usd: Number(body?.monthly_server_fee_usd ?? 10),
        payment_status: "paid",
      }),
    });

    const raw = await res.text();
    let payload: Record<string, unknown>;
    try {
      payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      payload = {
        error: raw || "Backend returned a non-JSON response",
      };
    }

    if (!res.ok) {
      const detail = String(payload.detail ?? payload.error ?? payload.message ?? "Payment completion failed");
      return NextResponse.json({ error: detail, detail }, { status: res.status });
    }

    return NextResponse.json(payload, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to complete purchase";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
