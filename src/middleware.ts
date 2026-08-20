import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Refreshes the Supabase auth session on every request and forwards the
 * updated auth cookies. This keeps `auth.getUser()` in route handlers backed
 * by a verified, current JWT — the sole source of the caller's identity (§4.5).
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Page-level gating. API routes enforce their own 401 (and return JSON, so
  // they must never be redirected). Unauthenticated page views go to /login;
  // an authenticated user hitting /login is sent home.
  const path = request.nextUrl.pathname;
  const isApi = path.startsWith("/api");
  const isPublic = path === "/login";

  if (!isApi && !user && !isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = "/login";
    to.searchParams.set("next", path);
    return NextResponse.redirect(to);
  }
  if (!isApi && user && isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = "/dashboard";
    to.search = "";
    return NextResponse.redirect(to);
  }

  return response;
}

export const config = {
  // Run on API routes and pages, skip static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
