import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  email?: string;
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
    return NextResponse.json({ settings: {} }, { status: 200 });
  }

  try {
    const response = await fetchBackend(`/settings?email=${encodeURIComponent(email)}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ settings: {} }, { status: 200 });
  }
}

export async function PUT(request: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await fetchBackend("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        settings: body?.settings ?? {},
      }),
    });

    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
