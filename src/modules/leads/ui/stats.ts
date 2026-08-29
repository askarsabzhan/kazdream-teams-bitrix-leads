export type LeadCounters = {
  total: number;
  synced: number;
  customers: number;
  partners: number;
};

export function calculateLeadCounters(
  leads: readonly { crmStatus: string; leadType: string }[],
): LeadCounters {
  return {
    total: leads.length,
    synced: leads.filter((lead) => lead.crmStatus === "succeeded").length,
    customers: leads.filter(
      (lead) => lead.leadType.toLocaleLowerCase() === "customer",
    ).length,
    partners: leads.filter(
      (lead) => lead.leadType.toLocaleLowerCase() === "partner",
    ).length,
  };
}
