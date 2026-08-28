import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readPublicEnvironment } from "@/lib/env/public";

export async function proxy(request: NextRequest) {
  const environment = readPublicEnvironment();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isProtected = pathname.startsWith("/leads") || pathname.startsWith("/admin");

  if (!data.user && isProtected) {
    const redirectResponse = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (data.user && pathname === "/login") {
    const redirectResponse = NextResponse.redirect(new URL("/leads", request.url));
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/", "/login", "/leads/:path*", "/admin/:path*"],
};
