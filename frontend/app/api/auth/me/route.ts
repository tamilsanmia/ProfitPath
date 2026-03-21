import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

type SessionUser = {
  id: number;
  first_name: string;
  last_name: string;
  username?: string;
  email: string;
  referral_url?: string;
  avatar?: string;
  is_admin?: boolean;
};

function isAdminUser(user?: SessionUser | null): boolean {
  const configured = String(process.env.ADMIN_USERNAME ?? "").trim().toLowerCase();
  if (!configured || !user) {
    return false;
  }

  const username = String(user.username ?? "").trim().toLowerCase();
  const emailLocalPart = String(user.email ?? "").split("@")[0]?.trim().toLowerCase() ?? "";
  return username === configured || emailLocalPart === configured;
}

export async function GET() {
  const cookieStore = await cookies();
  const raw = cookieStore.get("pp_user")?.value;
  const sessionToken = cookieStore.get("pp_session")?.value;

  if (!raw) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  try {
    const user = JSON.parse(raw) as SessionUser;
    const hasStaleReferralUrl = typeof user?.referral_url === "string" && user.referral_url.includes("localhost");
    if (user?.username && user?.referral_url && typeof user?.avatar === "string" && user.avatar.length > 0 && !hasStaleReferralUrl) {
      const enrichedUser: SessionUser = { ...user, is_admin: isAdminUser(user) };
      return NextResponse.json({ user: enrichedUser }, { status: 200 });
    }

    if (!user?.email) {
      const enrichedUser: SessionUser = { ...user, is_admin: isAdminUser(user) };
      return NextResponse.json({ user: enrichedUser }, { status: 200 });
    }

    const backendResponse = await fetchBackend(
      `/auth/me?email=${encodeURIComponent(user.email)}&session_token=${encodeURIComponent(sessionToken ?? "")}`,
      {
      cache: "no-store",
      }
    );

    if (!backendResponse.ok) {
      const response = NextResponse.json({ user: null }, { status: 200 });
      response.cookies.set("pp_session", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
      response.cookies.set("pp_user", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      });
      return response;
    }

    const payload = await backendResponse.json();
    const freshUser = payload?.user as SessionUser | undefined;
    if (!freshUser) {
      return NextResponse.json({ user }, { status: 200 });
    }

    const enrichedFreshUser: SessionUser = { ...freshUser, is_admin: isAdminUser(freshUser) };
    const response = NextResponse.json({ user: enrichedFreshUser }, { status: 200 });
    response.cookies.set("pp_user", JSON.stringify(enrichedFreshUser), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
