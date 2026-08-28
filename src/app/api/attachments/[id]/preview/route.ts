import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getViewer } from "@/modules/auth/session";

const idSchema = z.string().uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await getViewer())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) return Response.json({ error: "Invalid attachment." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const attachmentResult = await supabase
    .from("attachments")
    .select("storage_path, mime_type, fetch_state, is_current")
    .eq("id", parsed.data)
    .maybeSingle();

  const attachment = attachmentResult.data;
  if (
    attachmentResult.error ||
    !attachment ||
    !attachment.is_current ||
    attachment.fetch_state !== "fetched" ||
    !attachment.storage_path ||
    !attachment.mime_type?.startsWith("image/")
  ) {
    return Response.json({ error: "Preview is unavailable." }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const signedResult = await admin.storage
    .from("teams-attachments")
    .createSignedUrl(attachment.storage_path, 60);
  if (signedResult.error || !signedResult.data.signedUrl) {
    return Response.json({ error: "Preview is unavailable." }, { status: 404 });
  }

  const response = NextResponse.redirect(signedResult.data.signedUrl, 307);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
