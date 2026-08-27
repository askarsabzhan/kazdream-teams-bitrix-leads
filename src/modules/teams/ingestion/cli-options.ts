import type { TeamsIngestionMode } from "./types";

export interface TeamsIngestCliOptions {
  mode: TeamsIngestionMode;
  dryRun: boolean;
  verify: boolean;
  verifyOnly: boolean;
  limit: number;
  since: string;
  until: string;
}

export class TeamsIngestCliOptionsError extends Error {
  constructor() {
    super("Invalid teams:ingest arguments.");
    this.name = "TeamsIngestCliOptionsError";
  }
}

function valueAfterEquals(argument: string, name: string): string | null {
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : null;
}

function boundedInteger(value: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TeamsIngestCliOptionsError();
  }
  return parsed;
}

export function parseTeamsIngestArguments(
  arguments_: readonly string[],
  now = new Date(),
): TeamsIngestCliOptions {
  let mode: TeamsIngestionMode = "latest";
  let dryRun = false;
  let verify = false;
  let verifyOnly = false;
  let limitText: string | null = null;
  let sinceText: string | null = null;
  let untilText: string | null = null;

  for (const argument of arguments_) {
    if (argument === "--dry-run") dryRun = true;
    else if (argument === "--verify") verify = true;
    else if (argument === "--verify-only") verifyOnly = true;
    else {
      const modeValue = valueAfterEquals(argument, "--mode");
      const limitValue = valueAfterEquals(argument, "--limit");
      const sinceValue = valueAfterEquals(argument, "--since");
      const untilValue = valueAfterEquals(argument, "--until");
      if (modeValue === "latest" || modeValue === "catch-up") mode = modeValue;
      else if (limitValue !== null) limitText = limitValue;
      else if (sinceValue !== null) sinceText = sinceValue;
      else if (untilValue !== null) untilText = untilValue;
      else throw new TeamsIngestCliOptionsError();
    }
  }
  if ((dryRun && verify) || (dryRun && verifyOnly))
    throw new TeamsIngestCliOptionsError();
  const maximum = mode === "latest" ? 50 : 500;
  const limit = boundedInteger(limitText ?? "50", maximum);
  const defaultSince = new Date(now.valueOf() - 48 * 60 * 60 * 1_000);
  const defaultUntil = new Date(now.valueOf() + 5 * 60 * 1_000);
  const since = new Date(sinceText ?? defaultSince.toISOString());
  const until = new Date(untilText ?? defaultUntil.toISOString());
  if (
    !Number.isFinite(since.valueOf()) ||
    !Number.isFinite(until.valueOf()) ||
    until <= since
  ) {
    throw new TeamsIngestCliOptionsError();
  }

  return {
    mode,
    dryRun,
    verify,
    verifyOnly,
    limit,
    since: since.toISOString(),
    until: until.toISOString(),
  };
}
