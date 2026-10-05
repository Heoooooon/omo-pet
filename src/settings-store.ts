// Pet settings, shared between the pet windows and the settings panel.
// Persisted in localStorage (all windows share the same origin) and
// broadcast live over the Tauri event bus.
import { emit } from "@tauri-apps/api/event";

export type Instrument = "vocal" | "guitar" | "bass" | "drums" | "keys";

export type PetSettings = {
  pack: string; // main pet's character pack directory under /packs/
  companions: string[]; // more characters on screen, each in its own pet window
  size: number; // pet scale, 1 = 100%
  speed: number; // walk speed multiplier
  activity: number; // how often the pet does something (higher = busier)
  stunts: number; // rocket/jet frequency multiplier
  crossMonitors: boolean; // roam across adjacent displays
  ipadHandoff: boolean; // hand off to the iPad via Lanbeam
  bandRoster: Record<Instrument, string>; // pack id per band slot
  bandMuted: boolean; // band music starts silent until "sound on"
  bandVolume: number; // 0..1
  bandRandom: boolean; // the band sometimes gathers on its own
};

export const DEFAULT_ROSTER: Record<Instrument, string> = {
  vocal: "omo-cat",
  guitar: "dalli",
  bass: "bara",
  drums: "dochi",
  keys: "rupa",
};

export const DEFAULTS: PetSettings = {
  pack: "omo-cat",
  // Omo and Jabdori are the two free main characters and both show up on
  // first launch; either can be hidden from Settings > Character.
  companions: ["jabdori"],
  size: 1,
  speed: 1,
  activity: 1,
  stunts: 1,
  crossMonitors: true,
  ipadHandoff: true,
  bandRoster: { ...DEFAULT_ROSTER },
  bandMuted: true,
  bandVolume: 0.6,
  bandRandom: true,
};

const KEY = "omo-pet-settings";
export const SETTINGS_EVENT = "settings-changed";

export function loadSettings(): PetSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      ...DEFAULTS,
      ...saved,
      companions: Array.isArray(saved.companions) ? saved.companions : [...DEFAULTS.companions],
      bandRoster: { ...DEFAULT_ROSTER, ...(saved.bandRoster ?? {}) },
    };
  } catch {
    return { ...DEFAULTS, companions: [...DEFAULTS.companions], bandRoster: { ...DEFAULT_ROSTER } };
  }
}

export async function saveSettings(s: PetSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  await emit(SETTINGS_EVENT, s);
}
