// Files dropped anywhere in the app (or on the home page) are handed to the deck maker.
// The page takes them when it opens, or straight away when it's already open.

type Listener = (files: File[]) => void;

let pending: File[] = [];
const listeners = new Set<Listener>();

export function handOffFiles(files: File[]) {
  if (!files.length) return;
  if (listeners.size) listeners.forEach((l) => l(files));
  else pending = [...pending, ...files];
}

export function takeHandedOff(): File[] {
  const files = pending;
  pending = [];
  return files;
}

export function onHandOff(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Whether a drag carries files (not text or a link). */
export function dragHasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}
