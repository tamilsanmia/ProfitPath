import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const response = await fetchBackend("/users", { cache: "no-store" });
    const payload = await response.json();
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error("GET /api/users error:", error);
    return NextResponse.json({ error: "Failed to fetch users." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const backendPayload = {
      first_name: payload.firstName,
      last_name: payload.lastName,
      username: payload.username,
      email: payload.email,
      password: payload.password,
      referral_username: payload.referralUsername,
      phone: payload.phone,
      country: payload.country,
    };

    const response = await fetchBackend("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backendPayload),
    });

    let responsePayload: Record<string, unknown> = {};
    const raw = await response.text();
    if (raw) {
      try {
        responsePayload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        responsePayload = { error: raw };
      }
    }

    return NextResponse.json(responsePayload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create user.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
