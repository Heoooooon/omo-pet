// Band sound controls: a small pill above the stage. Sound is off by
// default; the song plays here (a click in this window is the user gesture
// audio needs) and is scheduled against the stage's start time.
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { initI18n, t } from "./i18n";
import { loadSettings, saveSettings, SETTINGS_EVENT, type PetSettings } from "./settings-store";
import { BandSynth } from "./band-music";
import { BAND_START, BAND_STOP } from "./band-shared";

const win = getCurrentWindow();
const q = new URLSearchParams(location.search);
const soundBtn = document.getElementById("sound") as HTMLButtonElement;
const volume = document.getElementById("volume") as HTMLInputElement;
const stopBtn = document.getElementById("stop") as HTMLButtonElement;

let s: PetSettings = loadSettings();
let synth: BandSynth | null = null;
let audio: AudioContext | null = null;
let t0: number | null = null;
let blocked = false;
let stopped = false;

function render() {
  const on = !s.bandMuted && !blocked;
  soundBtn.textContent = s.bandMuted
    ? `🔇 ${t("soundOn")}`
    : blocked
      ? `🔈 ${t("soundTap")}`
      : `🔊 ${t("soundOff")}`;
  soundBtn.className = s.bandMuted ? "off" : blocked ? "blocked" : "";
  volume.hidden = !on;
  volume.value = String(Math.round(s.bandVolume * 100));
}

async function startAudio() {
  if (stopped) return;
  audio ??= new AudioContext();
  synth ??= new BandSynth(audio);
  await audio.resume().catch(() => undefined);
  blocked = audio.state !== "running";
  if (!blocked) {
    synth.setVolume(s.bandMuted ? 0 : s.bandVolume);
    if (t0 !== null) synth.play(t0);
  }
  render();
}

soundBtn.addEventListener("click", async () => {
  if (s.bandMuted || blocked) {
    s = { ...s, bandMuted: false };
    void saveSettings(s);
    await startAudio();
  } else {
    s = { ...s, bandMuted: true };
    void saveSettings(s);
    synth?.setVolume(0);
    render();
  }
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
volume.addEventListener("input", () => {
  s = { ...s, bandVolume: Number(volume.value) / 100 };
  synth?.setVolume(s.bandVolume);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveSettings(s), 200);
});

stopBtn.addEventListener("click", () => {
  stopBtn.disabled = true;
  void emit(BAND_STOP);
});

void listen<PetSettings>(SETTINGS_EVENT, (e) => {
  s = e.payload;
  if (!s.bandMuted && synth && !blocked) synth.setVolume(s.bandVolume);
  if (s.bandMuted) synth?.setVolume(0);
  render();
});

void listen<{ t0: number }>(BAND_START, (e) => {
  t0 = e.payload.t0;
  if (!s.bandMuted) void startAudio();
});

void listen(BAND_STOP, () => {
  stopped = true;
  synth?.close();
  synth = null;
  audio = null;
});

initI18n(render);

async function place() {
  await win.setPosition(new PhysicalPosition(Number(q.get("px")), Number(q.get("py"))));
  await win.show();
}
void place();
