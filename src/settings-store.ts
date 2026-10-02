// Pet settings, shared between the pet windows and the settings panel.
// Persisted in localStorage (all windows share the same origin) and
// broadcast live over the Tauri event bus.
import { emit } from "@tauri-apps/api/event";

export type PetSettings = {
  pack: string; // character pack directory under /packs/
  size: number; // pet scale, 1 = 100%
  speed: number; // walk speed multiplier
  activity: number; // how often the pet does something (higher = busier)
  stunts: number; // rocket/jet frequency multiplier
  crossMonitors: boolean; // roam across adjacent displays
  ipadHandoff: boolean; // hand off to the iPad via Lanbeam
};

export const DEFAULTS: PetSettings = {
  pack: "omo-cat",
  size: 1,
  speed: 1,
  activity: 1,
  stunts: 1,
  crossMonitors: true,
  ipadHandoff: true,
};

const KEY = "omo-pet-settings";
export const SETTINGS_EVENT = "settings-changed";

export function loadSettings(): PetSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(s: PetSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  await emit(SETTINGS_EVENT, s);
}
