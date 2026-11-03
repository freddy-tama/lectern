// Files handed to the finished-deck page from elsewhere (the deck maker, the decks page).
// Kept apart from the page so linking to it doesn't load it.

let pending: File[] = [];

export function handOffFinished(files: File[]) {
  pending = [...pending, ...files];
}

export function takeFinished(): File[] {
  const files = pending;
  pending = [];
  return files;
}

/** A finished PowerPoint, its PDF, or pictures of its slides. */
export const FINISHED_ACCEPT = '.pptx,.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
