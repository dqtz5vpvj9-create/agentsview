import type { PinnedMessage } from "../../api/types.js";

export interface IndexedPin {
  pin: PinnedMessage;
  text: string;
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/** Index complete messages and metadata, not the card's truncated preview. */
export function indexPins(
  pins: PinnedMessage[],
  extraFields: (pin: PinnedMessage) => readonly string[] = () => [],
): IndexedPin[] {
  return pins.map((pin) => ({
    pin,
    text: normalize([
      pin.content, pin.session_id, pin.role, pin.session_project,
      pin.session_agent, pin.session_display_name, pin.session_first_message,
      ...extraFields(pin),
    ].filter((value): value is string => typeof value === "string").join("\n")),
  }));
}

/** Match every query word while preserving the existing pin ordering. */
export function filterPins(index: IndexedPin[], query: string): PinnedMessage[] {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return index.filter(({ text }) => terms.every((term) => text.includes(term)))
    .map(({ pin }) => pin);
}
