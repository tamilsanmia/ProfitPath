import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  email?: string;
};

export async function GET() {
  try {
    const cookieStore = await cookies();
    const rawUser = cookieStore.get("pp_user")?.value;
    const sessionToken = cookieStore.get("pp_session")?.value;

    if (!rawUser || !sessionToken) {
      return NextResponse.json([], { status: 200 });
    }

    let email = "";
    try {
      const user = JSON.parse(rawUser) as SessionUser;
      email = String(user?.email ?? "").trim().toLowerCase();
    } catch {
      return NextResponse.json([], { status: 200 });
    }

    if (!email) {
      return NextResponse.json([], { status: 200 });
    }

    const params = new URLSearchParams({
      email,
      session_token: sessionToken,
      purchased_only: "true",
    });

    const res = await fetchBackend(`/api/bots?${params.toString()}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list bots";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
