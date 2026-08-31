export type SourceMessagePresentation =
  | { hasText: true; text: string }
  | { hasText: false; text: null };

export function presentSourceMessage(text: string | null): SourceMessagePresentation {
  if (typeof text === "string" && text.trim().length > 0) {
    return { hasText: true, text };
  }

  return { hasText: false, text: null };
}
