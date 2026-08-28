export type DatabaseHealthProbe = () => Promise<boolean>;

export async function getLivenessStatus(databaseProbe: DatabaseHealthProbe) {
  const databaseAvailable = await databaseProbe().catch(() => false);
  return {
    status: databaseAvailable ? ("ok" as const) : ("unavailable" as const),
    application: "ok" as const,
    database: databaseAvailable ? ("ok" as const) : ("unavailable" as const),
  };
}
