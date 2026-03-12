import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  email?: string;
};

const DEFAULT_SETTINGS = {
  email_notifications: true,
  show_in_leaderboard: true,
  auto_share_achievements: false,
};

async function getSessionEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  if (!rawUser) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser) as SessionUser;
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ settings: DEFAULT_SETTINGS }, { status: 200 });
  }

  try {
    const response = await fetchBackend(`/referrals/settings?email=${encodeURIComponent(email)}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ settings: DEFAULT_SETTINGS }, { status: 200 });
  }
}

export async function PUT(request: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await fetchBackend("/referrals/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        email_notifications: Boolean(body?.email_notifications),
        show_in_leaderboard: Boolean(body?.show_in_leaderboard),
        auto_share_achievements: Boolean(body?.auto_share_achievements),
      }),
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Failed to update referral settings" }, { status: 500 });
  }
}
