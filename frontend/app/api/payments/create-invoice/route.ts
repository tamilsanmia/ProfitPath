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

    const res = await fetchBackend("/payments/create-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: userEmail,
        session_token: sessionToken,
        price_amount: Number(body?.price_amount ?? 0),
        order_description: String(body?.order_description ?? "BotPrimeX Bot Subscription"),
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = String(
        (payload as Record<string, unknown>)?.detail ??
          (payload as Record<string, unknown>)?.error ??
          "Failed to create invoice"
      );
      return NextResponse.json({ error: detail }, { status: res.status });
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
