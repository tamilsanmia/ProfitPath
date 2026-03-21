import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  username?: string;
  email?: string;
};

function isAdminUser(user?: SessionUser | null): boolean {
  const configured = String(process.env.ADMIN_USERNAME ?? process.env.BACKEND_ADMIN_USERNAME ?? "").trim().toLowerCase();
  if (!configured || !user) {
    return false;
  }

  const username = String(user.username ?? "").trim().toLowerCase();
  const emailLocalPart = String(user.email ?? "").split("@")[0]?.trim().toLowerCase() ?? "";
  return username === configured || emailLocalPart === configured;
}

async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  if (!rawUser) {
    return null;
  }

  try {
    const user = JSON.parse(rawUser) as SessionUser;
    return user;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const requestPayload = {
      ...body,
      email: user?.email,
    };

    const response = await fetchBackend("/admin/email/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.detail === "string" && payload.detail) ||
        "Failed to send test email";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send test email" },
      { status: 500 }
    );
  }
}
