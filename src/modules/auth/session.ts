import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAppRole, type AppRole } from "./access";

export type Viewer = {
  user: User;
  role: AppRole;
  displayName: string | null;
};

export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const profileResult = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileResult.error || !profileResult.data || !isAppRole(profileResult.data.role)) {
    return null;
  }

  return {
    user: data.user,
    role: profileResult.data.role,
    displayName: profileResult.data.display_name,
  };
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    redirect("/login");
  }
  return viewer;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.role !== "admin") {
    redirect("/forbidden");
  }
  return viewer;
}
