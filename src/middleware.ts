import { NextRequest, NextResponse } from "next/server";

// Cookie-based password gate. The login page sets `app_auth=<password>` after
// validating against process.env.APP_PASSWORD; this middleware compares the
// cookie value against the same env var on every request. If APP_PASSWORD is
// unset (e.g. local dev without a .env line), no gate runs.
//
// Cookie is httpOnly + secure + SameSite=Lax so it can't be read or set by
// browser JS or cross-site requests.
export function middleware(req: NextRequest) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return NextResponse.next();

  const path = req.nextUrl.pathname;

  // Always allow the login page and its submission endpoints through.
  if (path === "/login" || path === "/api/auth/login" || path === "/api/auth/logout") {
    return NextResponse.next();
  }

  const auth = req.cookies.get("app_auth")?.value;
  if (auth && auth === expected) return NextResponse.next();

  // For API routes, return 401 instead of redirecting (so client fetches
  // surface the auth failure cleanly rather than getting an HTML login page).
  if (path.startsWith("/api/")) {
    return new NextResponse("Authentication required.", { status: 401 });
  }

  // Redirect HTML page requests to /login, preserving the originally requested path.
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  if (path !== "/") url.searchParams.set("from", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand|fonts).*)"],
};
