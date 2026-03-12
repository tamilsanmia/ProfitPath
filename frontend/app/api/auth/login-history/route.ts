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

export async function GET() {
  const { email, token } = await getSessionContext();
  if (!email || !token) {
    return NextResponse.json({ loginHistory: [] }, { status: 200 });
  }

  try {
    const response = await fetchBackend(
      `/auth/login-history?email=${encodeURIComponent(email)}&session_token=${encodeURIComponent(token)}`,
      { cache: "no-store" }
    );
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json({ loginHistory: [] }, { status: 200 });
    }

    return NextResponse.json({ loginHistory: Array.isArray(payload?.login_history) ? payload.login_history : [] }, { status: 200 });
  } catch {
    return NextResponse.json({ loginHistory: [] }, { status: 200 });
  }
}
