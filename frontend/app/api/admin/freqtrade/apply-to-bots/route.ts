import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = { username?: string; email?: string };

function isAdminUser(user?: SessionUser | null): boolean {
  const configured = String(process.env.ADMIN_USERNAME ?? process.env.BACKEND_ADMIN_USERNAME ?? "").trim().toLowerCase();
  if (!configured || !user) return false;
  const username = String(user.username ?? "").trim().toLowerCase();
  const emailLocalPart = String(user.email ?? "").split("@")[0]?.trim().toLowerCase() ?? "";
  return username === configured || emailLocalPart === configured;
}

async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  if (!rawUser) return null;
  try { return JSON.parse(rawUser) as SessionUser; } catch { return null; }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const res = await fetchBackend("/admin/freqtrade/apply-to-bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to apply to bots" }, { status: 502 });
  }
}
