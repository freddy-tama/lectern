import type { AnyKind } from './types';

const kinds = new Map<string, AnyKind>();

export function registerKind(def: AnyKind) {
  kinds.set(def.kind, def);
}

export function getKind(kind: string): AnyKind | undefined {
  return kinds.get(kind);
}

export function allKinds(): AnyKind[] {
  return [...kinds.values()];
}
