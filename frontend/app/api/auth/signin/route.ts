import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await fetchBackend("/auth/signin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-user-agent": request.headers.get("user-agent") ?? "",
        "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "",
        "x-real-ip": request.headers.get("x-real-ip") ?? "",
      },
      body: JSON.stringify({
        email: payload?.email,
        password: payload?.password,
        otp_code: payload?.otp_code,
        backup_code: payload?.backup_code,
        client_public_ip: payload?.client_public_ip,
        client_location: payload?.client_location,
        client_device: payload?.client_device,
      }),
    });

    const responsePayload = await response.json();

    if (!response.ok) {
      const detail = responsePayload?.detail;
      const backendError = typeof detail === "string" ? detail : detail?.message ?? responsePayload?.error ?? "Failed to sign in.";
      const requires2fa = Boolean(detail?.requires_2fa);
      return NextResponse.json({ error: backendError, requires2fa }, { status: response.status });
    }

    const nextResponse = NextResponse.json(responsePayload, { status: response.status });
    nextResponse.cookies.set("pp_session", String(responsePayload.session_token ?? ""), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    nextResponse.cookies.set("pp_user", JSON.stringify(responsePayload.user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return nextResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sign in.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
