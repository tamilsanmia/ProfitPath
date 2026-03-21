import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  email?: string;
};

async function getSessionContext() {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  const sessionToken = cookieStore.get("pp_session")?.value;

  if (!rawUser || !sessionToken) {
    return { email: null, sessionToken: null };
  }

  try {
    const user = JSON.parse(rawUser) as SessionUser;
    return {
      email: user?.email ?? null,
      sessionToken,
    };
  } catch {
    return { email: null, sessionToken: null };
  }
}

export async function POST() {
  const { email, sessionToken } = await getSessionContext();
  if (!email || !sessionToken) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const response = await fetchBackend("/settings/cleanup-deprecated-admin-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        session_token: sessionToken,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Failed to cleanup deprecated admin settings" }, { status: 500 });
  }
}