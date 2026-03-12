import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = { email?: string };

async function getSessionEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  if (!rawUser) return null;

  try {
    const user = JSON.parse(rawUser) as SessionUser;
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export async function POST() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const response = await fetchBackend("/auth/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: payload?.detail ?? "Failed to disable 2FA" }, { status: response.status });
    }

    return NextResponse.json(payload, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Failed to disable 2FA" }, { status: 500 });
  }
}
