import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const runtime = "nodejs";

function firstPublicIp(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const candidates = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const ip of candidates) {
    // Skip obvious local/private placeholders.
    if (
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip.startsWith("10.") ||
      ip.startsWith("192.168.") ||
      ip.startsWith("172.16.") ||
      ip.startsWith("172.17.") ||
      ip.startsWith("172.18.") ||
      ip.startsWith("172.19.") ||
      ip.startsWith("172.2") ||
      ip.startsWith("fc") ||
      ip.startsWith("fd")
    ) {
      continue;
    }

    return ip;
  }

  return null;
}

interface IpGeoResponse {
  countryCode: string | null
  country: string | null
  state: string | null
  stateCode: string | null
  timezone: string | null
}

async function lookupGeo(ip: string | null): Promise<IpGeoResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const endpoint = ip ? `https://ipapi.co/${encodeURIComponent(ip)}/json/` : "https://ipapi.co/json/";
    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        countryCode: null,
        country: null,
        state: null,
        stateCode: null,
        timezone: null,
      };
    }

    const payload = (await response.json()) as {
      country_code?: string
      country_name?: string
      region?: string
      region_code?: string
      timezone?: string
    }

    const code = String(payload.country_code ?? "").trim().toUpperCase()
    const countryCode = code.length === 2 ? code : null
    const country = String(payload.country_name ?? "").trim() || null
    const state = String(payload.region ?? "").trim() || null
    const stateCode = String(payload.region_code ?? "").trim().toUpperCase() || null
    const timezone = String(payload.timezone ?? "").trim() || null

    return {
      countryCode,
      country,
      state,
      stateCode,
      timezone,
    }
  } catch {
    return {
      countryCode: null,
      country: null,
      state: null,
      stateCode: null,
      timezone: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const realIp = requestHeaders.get("x-real-ip");
  const cfIp = requestHeaders.get("cf-connecting-ip");

  const ip =
    firstPublicIp(cfIp) ??
    firstPublicIp(realIp) ??
    firstPublicIp(forwardedFor) ??
    null;

  const geo = await lookupGeo(ip);

  return NextResponse.json(
    {
      countryCode: geo.countryCode ?? "",
      country: geo.country ?? "",
      state: geo.state ?? "",
      stateCode: geo.stateCode ?? "",
      timezone: geo.timezone ?? "",
    },
    { status: 200 },
  );
}
