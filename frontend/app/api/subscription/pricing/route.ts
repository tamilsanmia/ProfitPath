import { NextResponse } from "next/server";
import { fetchBackend } from "@/lib/backend-api";

export const runtime = "nodejs";

const DEFAULTS = {
  monthlyServerFee: 10,
  setupCharge: 0,
};

/**
 * Public endpoint returning admin-configured subscription pricing.
 */
export async function GET() {
  const adminUsername = String(
    process.env.ADMIN_USERNAME ?? process.env.BACKEND_ADMIN_USERNAME ?? ""
  ).trim();

  try {
    const res = await fetchBackend(
      `/subscription/pricing?admin_username=${encodeURIComponent(adminUsername)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json(DEFAULTS);
    const data = await res.json();
    return NextResponse.json({
      monthlyServerFee: data.monthlyServerFee ?? DEFAULTS.monthlyServerFee,
      setupCharge: data.setupCharge ?? DEFAULTS.setupCharge,
    });
  } catch {
    return NextResponse.json(DEFAULTS);
  }
}
