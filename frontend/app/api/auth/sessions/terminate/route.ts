import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = { email?: string };

async function getSessionContext(): Promise<{ email: string | null; token: string | null }> {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  const token = cookieStore.get("pp_session")?.value ?? null;

  if (!rawUser) {
    return { email: null, token };
  }

  try {
    const user = JSON.parse(rawUser) as SessionUser;
    return { email: user?.email ?? null, token };
  } catch {
    return { email: null, token };
  }
}

export async function POST(request: Request) {
  const { email, token } = await getSessionContext();
  if (!email || !token) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await fetchBackend("/auth/sessions/terminate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        session_token: token,
        session_id: body?.sessionId ?? "",
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: payload?.detail ?? "Failed to terminate session" }, { status: response.status });
    }

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to terminate session" }, { status: 500 });
  }
}
