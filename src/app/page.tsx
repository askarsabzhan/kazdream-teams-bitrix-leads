import { redirect } from "next/navigation";

import { getViewer } from "@/modules/auth/session";

export default async function Home() {
  redirect((await getViewer()) ? "/leads" : "/login");
}
