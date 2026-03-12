import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchBackend } from "@/lib/backend-api";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  let origin = requestUrl.origin;
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      origin = new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
    } catch {
      origin = requestUrl.origin;
    }
  }

  const redirectUrl = new URL("/login", origin);

  const cookieStore = await cookies();
  const rawUser = cookieStore.get("pp_user")?.value;
  const sessionToken = cookieStore.get("pp_session")?.value;

  try {
    if (rawUser && sessionToken) {
      const user = JSON.parse(rawUser) as { email?: string };
      if (user?.email) {
        await fetchBackend("/auth/signout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email, session_token: sessionToken }),
        });
      }
    }
  } catch {
    // Best effort sign-out; always clear cookies below.
  }

  const response = NextResponse.redirect(redirectUrl);
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
