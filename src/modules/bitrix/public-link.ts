export function buildPublicBitrixLeadUrl(
  portalUrl: string | undefined,
  leadId: number | null,
): string | null {
  if (!portalUrl || !Number.isSafeInteger(leadId) || (leadId ?? 0) <= 0) return null;

  let portal: URL;
  try {
    portal = new URL(portalUrl);
  } catch {
    return null;
  }

  if (
    portal.protocol !== "https:" ||
    portal.username ||
    portal.password ||
    (portal.pathname !== "/" && portal.pathname !== "") ||
    portal.search ||
    portal.hash
  ) {
    return null;
  }

  portal.pathname = `/crm/lead/details/${leadId}/`;
  return portal.toString();
}
