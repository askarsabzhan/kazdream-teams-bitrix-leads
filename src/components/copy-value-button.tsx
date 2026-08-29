"use client";

import { useState } from "react";

type ClipboardWriter = Pick<Clipboard, "writeText">;

export async function copyExactValue(
  value: string,
  clipboard: ClipboardWriter = navigator.clipboard,
): Promise<void> {
  await clipboard.writeText(value);
}

export function CopyValueButton({
  value,
  labels,
}: {
  value: string;
  labels: { copy: string; copied: string };
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await copyExactValue(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      className="shrink-0 rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
      onClick={copy}
      type="button"
    >
      {copied ? labels.copied : labels.copy}
    </button>
  );
}
