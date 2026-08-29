"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getI18n } from "@/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

export type LoginState = { error?: string };

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const { dictionary } = await getI18n();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: dictionary.auth.invalidInput };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: dictionary.auth.invalidCredentials };
  }

  redirect("/leads");
}

export async function logoutAction(): Promise<never> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
