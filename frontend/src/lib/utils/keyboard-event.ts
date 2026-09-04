/** IME confirmation keys are input, not application shortcuts (including Safari's 229). */
export function isComposingKey(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  return event.isComposing || event.keyCode === 229;
}
