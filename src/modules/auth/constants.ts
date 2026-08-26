export const APP_ROLES = ["user", "admin"] as const;

export type AppRole = (typeof APP_ROLES)[number];
