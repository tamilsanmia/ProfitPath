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

export async function POST(request: Request) {
  const email = await getSessionEmail();
  if (!email) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const response = await fetchBackend("/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        current_password: body?.currentPassword ?? "",
        new_password: body?.newPassword ?? "",
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const backendError = payload?.detail ?? payload?.error ?? "Failed to change password";
      return NextResponse.json({ error: backendError }, { status: response.status });
    }

    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 });
  }
}
