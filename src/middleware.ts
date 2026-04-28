import { NextRequest, NextResponse } from "next/server";

// Lightweight HTTP Basic Auth gate. When APP_PASSWORD is set on the host
// (Vercel env vars), every request must come with the right credentials before
// it reaches a route handler. If APP_PASSWORD is unset, no gate is applied —
// useful for local dev where you don't want to type a password on every reload.
//
// Username is ignored; we only check the password. The browser caches the
// credentials for the session so it's a one-time prompt per browser.
export function middleware(req: NextRequest) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (auth) {
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      try {
        const decoded = atob(encoded);
        const sep = decoded.indexOf(":");
        const provided = sep >= 0 ? decoded.slice(sep + 1) : decoded;
        if (provided === expected) return NextResponse.next();
      } catch {
        // fall through to 401
      }
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Content Studio"' },
  });
}

// Exclude Next.js internals and static assets so they don't trigger the prompt.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand|fonts).*)"],
};
