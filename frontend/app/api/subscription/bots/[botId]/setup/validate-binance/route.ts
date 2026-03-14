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

type ValidateBody = {
  apiKey?: string;
  apiSecret?: string;
};

export async function POST(request: Request, { params }: Params) {
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

  let body: ValidateBody;
  try {
    body = (await request.json()) as ValidateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const apiKey = String(body.apiKey ?? "").trim();
  const apiSecret = String(body.apiSecret ?? "").trim();

  try {
    const response = await fetchBackend(`/subscriptions/${encodeURIComponent(botId)}/setup/validate-binance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        session_token: sessionToken,
        api_key: apiKey || null,
        api_secret: apiSecret || null,
      }),
    });

    const raw = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      payload = { error: raw || "Backend returned a non-JSON response" };
    }

    if (!response.ok) {
      const detail = String(payload.detail ?? payload.error ?? payload.message ?? "Binance API validation failed");
      return NextResponse.json({ error: detail, detail }, { status: response.status });
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to validate Binance API";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
