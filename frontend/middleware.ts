import { NextResponse, type NextRequest } from "next/server";

const AUTH_PAGES = new Set(["/login", "/signin", "/signup", "/forgot-password", "/reset-password"]);
const PUBLIC_PATH_PREFIXES = ["/invite/", "/shared/"];
const PUBLIC_API_PREFIXES = [
  "/api/auth/signin",
  "/api/auth/google",
  "/api/auth/logout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/users",
  "/api/geo/country",
  "/api/shared/bot-accounts",
];

function isStaticPath(pathname: string): boolean {
  return pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".");
}

function getCanonicalOrigin(fallbackOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) {
    return fallbackOrigin;
  }

  try {
    return new URL(configured).origin;
  } catch {
    return fallbackOrigin;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = getCanonicalOrigin(request.nextUrl.origin);

  if (isStaticPath(pathname)) {
    return NextResponse.next();
  }

  const isPublicApi = PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isPublicApi) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isPublicPath) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get("pp_session")?.value);

  if (!hasSession && !AUTH_PAGES.has(pathname)) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  if (hasSession && AUTH_PAGES.has(pathname)) {
    return NextResponse.redirect(new URL("/", origin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
