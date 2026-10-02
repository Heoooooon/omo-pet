// Settings panel: edits PetSettings and broadcasts changes live.
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  DEFAULTS,
  loadSettings,
  saveSettings,
  type PetSettings,
} from "./settings-store";

const win = getCurrentWindow();
let s = loadSettings();

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

// Sliders hold percentages; settings hold multipliers.
const SLIDERS = ["size", "speed", "activity", "stunts"] as const;
const TOGGLES = ["crossMonitors", "ipadHandoff"] as const;

function render() {
  for (const key of SLIDERS) {
    $<HTMLInputElement>(key).value = String(Math.round(s[key] * 100));
    $<HTMLOutputElement>(`${key}-out`).value = `${Math.round(s[key] * 100)}%`;
  }
  for (const key of TOGGLES) $<HTMLInputElement>(key).checked = s[key];
  for (const btn of $("packs").querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.pack === s.pack);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveSettings(s), 120);
}

for (const key of SLIDERS) {
  $<HTMLInputElement>(key).addEventListener("input", (e) => {
    s = { ...s, [key]: Number((e.target as HTMLInputElement).value) / 100 };
    $<HTMLOutputElement>(`${key}-out`).value =
      `${Math.round(s[key] * 100)}%`;
    queueSave();
  });
}

for (const key of TOGGLES) {
  $<HTMLInputElement>(key).addEventListener("change", (e) => {
    s = { ...s, [key]: (e.target as HTMLInputElement).checked };
    queueSave();
  });
}

$("packs").addEventListener("click", (e) => {
  const pack = (e.target as HTMLElement).dataset?.pack;
  if (!pack) return;
  s = { ...s, pack };
  render();
  queueSave();
});

$("reset").addEventListener("click", () => {
  s = { ...(DEFAULTS as PetSettings) };
  render();
  queueSave();
});

$("close").addEventListener("click", () => void win.close());

$("drag").addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).id === "close") return;
  void win.startDragging();
});

// Pack buttons: bundled packs (packs.json) plus packs built locally, e.g. by
// scripts/make-chiikawa-pack.mjs (local.json, git-ignored, may be missing).
type PackInfo = { id: string; name: string; emoji?: string };

async function fetchPacks(url: string): Promise<PackInfo[]> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PackInfo[]) : [];
  } catch {
    return []; // no local packs yet
  }
}

async function renderPacks() {
  const packs = [
    ...(await fetchPacks("/packs/packs.json")),
    ...(await fetchPacks("/packs/local.json")),
  ];
  $("packs").replaceChildren(
    ...packs.map((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.pack = p.id;
      btn.textContent = p.emoji ? `${p.emoji} ${p.name}` : p.name;
      return btn;
    }),
  );
  render();
}

render();
void renderPacks();
