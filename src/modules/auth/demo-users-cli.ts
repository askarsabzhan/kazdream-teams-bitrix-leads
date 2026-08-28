import "server-only";

import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const environmentSchema = z
  .object({
    DEMO_ADMIN_EMAIL: z.string().email().max(320),
    DEMO_ADMIN_PASSWORD: z.string().min(12).max(1024),
    DEMO_USER_EMAIL: z.string().email().max(320),
    DEMO_USER_PASSWORD: z.string().min(12).max(1024),
  })
  .refine((value) => value.DEMO_ADMIN_EMAIL !== value.DEMO_USER_EMAIL, {
    message: "Demo identities must be different.",
  });

async function findUserId(email: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  for (let page = 1; page <= 10; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new Error("Demo user lookup failed.");
    const match = result.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (result.data.users.length < 100) return null;
  }
  throw new Error("Demo user lookup exceeded its safe bound.");
}

async function ensureUser(email: string, password: string, role: "user" | "admin") {
  const admin = createSupabaseAdminClient();
  const existingId = await findUserId(email);
  const userId = existingId
    ? (
        await admin.auth.admin.updateUserById(existingId, {
          password,
          email_confirm: true,
        })
      ).data.user?.id
    : (
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        })
      ).data.user?.id;

  if (!userId) throw new Error("Demo user creation failed.");
  const promotion = await admin.rpc("set_app_profile_role", {
    p_user_id: userId,
    p_role: role,
  });
  if (promotion.error) throw new Error("Demo role assignment failed.");
}

async function main() {
  const environment = environmentSchema.parse(process.env);
  await ensureUser(environment.DEMO_USER_EMAIL, environment.DEMO_USER_PASSWORD, "user");
  await ensureUser(environment.DEMO_ADMIN_EMAIL, environment.DEMO_ADMIN_PASSWORD, "admin");
  process.stdout.write("DEMO_USERS_READY=2 ADMIN=1 USER=1\n");
}

main().catch(() => {
  process.stderr.write("DEMO_USERS_READY=0\n");
  process.exitCode = 1;
});
