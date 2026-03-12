import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await fetchBackend("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responsePayload = await response.json();
    return NextResponse.json(responsePayload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset password.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
