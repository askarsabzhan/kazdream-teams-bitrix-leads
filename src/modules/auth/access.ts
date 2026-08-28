export const APP_ROLES = ["user", "admin"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export type RouteAccessDecision =
  | { kind: "allow" }
  | { kind: "redirect"; destination: "/login" | "/leads" | "/forbidden" };

export function isAppRole(value: unknown): value is AppRole {
  return APP_ROLES.includes(value as AppRole);
}

export function decideRouteAccess(
  pathname: string,
  authenticated: boolean,
  role?: AppRole,
): RouteAccessDecision {
  const protectedRoute =
    pathname === "/leads" ||
    pathname.startsWith("/leads/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");

  if (!authenticated && protectedRoute) {
    return { kind: "redirect", destination: "/login" };
  }

  if (authenticated && pathname === "/login") {
    return { kind: "redirect", destination: "/leads" };
  }

  if (authenticated && pathname.startsWith("/admin") && role !== "admin") {
    return { kind: "redirect", destination: "/forbidden" };
  }

  return { kind: "allow" };
}
