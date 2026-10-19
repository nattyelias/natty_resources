// Remembering which mode the person chose. Pure: the storage is passed in (localStorage in the app),
// and every call survives a missing, blocked or full storage by falling back to DEFAULT_MODE.

import { DEFAULT_MODE } from './config.ts';
import type { ViewMode } from './types.ts';

export const MODE_STORAGE_KEY = 'natty-resources:view-mode';

/** The part of Storage this needs, so tests and non-browser code can pass a stand-in. */
export interface ModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const isViewMode = (value: unknown): value is ViewMode => value === 'grad' || value === 'undergrad';

/** The saved mode, or DEFAULT_MODE when storage is unavailable, throws, or holds anything but "grad" or "undergrad". */
export function readMode(storage: ModeStorage | null | undefined): ViewMode {
  try {
    const saved = storage?.getItem(MODE_STORAGE_KEY);
    return isViewMode(saved) ? saved : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/** Saves the mode. Returns false (and saves nothing) when the mode is invalid or storage is unavailable or throws. */
export function writeMode(storage: ModeStorage | null | undefined, mode: ViewMode): boolean {
  if (!storage || !isViewMode(mode)) return false;
  try {
    storage.setItem(MODE_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
