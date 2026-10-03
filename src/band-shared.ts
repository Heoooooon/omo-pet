// Band mode constants shared by the pet, the stage window, the sound
// controls and the settings panel.
import type { Instrument } from "./settings-store";

// Left to right on the stage; the singer stands in the middle.
export const STAGE_ORDER: readonly Instrument[] = ["keys", "guitar", "vocal", "bass", "drums"];
export const INSTRUMENT_EMOJI: Record<Instrument, string> = {
  vocal: "🎤",
  guitar: "🎸",
  bass: "🎸",
  drums: "🥁",
  keys: "🎹",
};

// The song: 14 bars of 4/4 at 160 BPM = 21 s. Every play loop is 3 s
// (two bars), so the drawn loops and the music stay on the same grid.
export const BPM = 160;
export const BARS = 14;
export const BEAT = 60 / BPM;
export const SONG_SECONDS = BARS * 4 * BEAT;

export const BAND_OPEN = "band-open";
export const BAND_START = "band-start"; // { t0 } epoch ms when the song starts
export const BAND_STOP = "band-stop";
export const BAND_PET = "band-pet"; // { join } the pet's own pack is on stage
export const BAND_ENDED = "band-ended"; // { x } physical center x to reappear at
export const LAST_BAND_KEY = "omo-pet-last-band";
