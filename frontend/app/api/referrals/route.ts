import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  email?: string;
};

export async function GET() {
  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;

  if (!rawUser) {
    return NextResponse.json({ referrals: [] }, { status: 200 });
  }

  try {
    const user = JSON.parse(rawUser) as SessionUser;
    if (!user?.email) {
      return NextResponse.json({ referrals: [] }, { status: 200 });
    }

    const response = await fetchBackend(`/referrals?email=${encodeURIComponent(user.email)}`, {
      cache: "no-store",
    });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch {
    return NextResponse.json({ referrals: [] }, { status: 200 });
  }
}
