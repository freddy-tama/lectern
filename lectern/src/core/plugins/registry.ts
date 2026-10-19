import { registerTheme } from '../engine/themes';
import { registerKind } from '../kinds/registry';
import type { DeckExporter, DeckSource, LecternPlugin, NotesField, PresenterToggle } from './api';

const installed: LecternPlugin[] = [];

export function installPlugin(plugin: LecternPlugin) {
  if (installed.some((p) => p.id === plugin.id)) return;
  for (const kind of plugin.kinds ?? []) {
    if (!kind.kind.startsWith(`${plugin.id}.`)) {
      console.warn(`Mod "${plugin.id}" registered kind "${kind.kind}" without its id prefix; skipped.`);
      continue;
    }
    registerKind({ ...kind, plugin: plugin.id });
  }
  plugin.themes?.forEach(registerTheme);
  installed.push(plugin);
}

export function installedPlugins(): readonly LecternPlugin[] {
  return installed;
}

export function deckSources(): (DeckSource & { plugin: string })[] {
  return installed.flatMap((p) => (p.deckSources ?? []).map((s) => ({ ...s, plugin: p.id })));
}

export function exporters(): (DeckExporter & { plugin: string })[] {
  return installed.flatMap((p) => (p.exporters ?? []).map((e) => ({ ...e, plugin: p.id })));
}

export function toggles(): (PresenterToggle & { plugin: string })[] {
  return installed.flatMap((p) => (p.toggles ?? []).map((t) => ({ ...t, plugin: p.id })));
}

export function notesFields(): (NotesField & { plugin: string })[] {
  return installed.flatMap((p) => (p.notesFields ?? []).map((f) => ({ ...f, plugin: p.id })));
}

export function deckFields(): { plugin: string; name: string; fields: NotesField[] }[] {
  return installed.filter((p) => p.deckFields?.length).map((p) => ({ plugin: p.id, name: p.name, fields: p.deckFields! }));
}

/** Flags that start on, so slide layouts see them before the presenter presses anything. */
export function toggleDefaults(): Record<string, boolean> {
  return Object.fromEntries(installed.flatMap((p) => (p.toggles ?? []).map((t) => [t.flag, Boolean(t.defaultOn)])));
}

export function draftingHints(): string {
  return installed.map((p) => p.draftingHints?.trim()).filter(Boolean).join('\n\n');
}
