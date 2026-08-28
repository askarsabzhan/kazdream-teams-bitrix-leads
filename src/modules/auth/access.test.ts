import { describe, expect, it } from "vitest";

import { decideRouteAccess } from "./access";

describe("route access", () => {
  it.each(["/leads", "/leads/00000000-0000-4000-8000-000000000001", "/admin"])(
    "redirects unauthenticated access to %s",
    (pathname) => {
      expect(decideRouteAccess(pathname, false)).toEqual({
        kind: "redirect",
        destination: "/login",
      });
    },
  );

  it("denies a normal user direct admin access", () => {
    expect(decideRouteAccess("/admin", true, "user")).toEqual({
      kind: "redirect",
      destination: "/forbidden",
    });
  });

  it("allows an admin direct admin access", () => {
    expect(decideRouteAccess("/admin", true, "admin")).toEqual({ kind: "allow" });
  });
});
