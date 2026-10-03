// Band stage: one click-through window across the bottom of the pet's
// monitor. Five members walk in from the screen edges, gather on the
// taskbar line, play the song in sync, bow and walk off again.
import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { retimeApng, type Bytes } from "./apng";
import { listUsablePacks, packStride, spriteUrl, type PackInfo } from "./packs";
import { DEFAULT_ROSTER, loadSettings, type Instrument } from "./settings-store";
import {
  BAND_ENDED,
  BAND_PET,
  BAND_START,
  BAND_STOP,
  SONG_SECONDS,
  STAGE_ORDER,
} from "./band-shared";

type Sprite = { bytes: Bytes; url: string; w: number; h: number };
type Member = {
  inst: Instrument;
  pack: PackInfo;
  idle: Sprite;
  walk: Sprite | null;
  play: Sprite;
  el: HTMLDivElement;
  img: HTMLImageElement;
  x: number;
  slotX: number;
  isPet: boolean;
};

const q = new URLSearchParams(location.search);
const num = (k: string) => Number(q.get(k) ?? 0);
const mon = { x: num("mx"), y: num("my"), w: num("mw"), h: num("mh") };
const work = { y: num("wy"), h: num("wh") };
const scale = num("scale") || 1;
const petPack = q.get("petPack") ?? "";
const petOnFloor = q.get("petOnFloor") === "1";
const petLocalX = (num("petX") - mon.x) / scale;

const ABOVE = 380; // logical px of stage above the taskbar line
const IDLE_WIDTH = 176; // the pet's idle display width at 100%
const SPACING = 1.04; // play cells are trimmed to the instrument; leave a little air

const win = getCurrentWindow();
const stage = document.getElementById("stage")!;
const membersEl = document.getElementById("members")!;
const notesEl = document.getElementById("notes")!;
const riser = document.getElementById("riser") as unknown as SVGSVGElement;
const lights = document.getElementById("lights")!;

let stopRequested = false;
void listen(BAND_STOP, () => {
  stopRequested = true;
});

// Rust-side sleep: WebKit may throttle JS timers of non-key windows.
const sleep = (ms: number) => invoke("motion_tick", { durationMs: Math.max(0, Math.round(ms)) });

async function sleepUnlessStopped(ms: number) {
  const end = performance.now() + ms;
  while (!stopRequested && performance.now() < end) {
    await sleep(Math.min(200, end - performance.now()));
  }
}

async function loadSprite(pack: string, state: string): Promise<Sprite> {
  const res = await fetch(spriteUrl(pack, `${state}.apng`), { cache: "no-store" });
  if (!res.ok) throw new Error(`${pack}/${state}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  const img = new Image();
  img.src = url;
  await img.decode();
  return { bytes, url, w: img.naturalWidth, h: img.naturalHeight };
}

async function loadMember(inst: Instrument, pack: PackInfo): Promise<Omit<Member, "el" | "img" | "x" | "slotX" | "isPet">> {
  const [idle, play] = await Promise.all([loadSprite(pack.id, "idle"), loadSprite(pack.id, "play")]);
  const walk = await loadSprite(pack.id, "walk").catch(() => null);
  return { inst, pack, idle, walk, play };
}

async function resolveMembers(): Promise<Omit<Member, "el" | "img" | "x" | "slotX" | "isPet">[]> {
  const packs = await listUsablePacks();
  const roster = loadSettings().bandRoster;
  const out = [];
  for (const inst of STAGE_ORDER) {
    const chosen = packs.find((p) => p.id === roster[inst] && p.instrument === inst);
    const fallback = packs.find((p) => p.id === DEFAULT_ROSTER[inst]);
    let member = null;
    if (chosen) member = await loadMember(inst, chosen).catch(() => null);
    if (!member && fallback) member = await loadMember(inst, fallback).catch(() => null);
    if (member) out.push(member);
  }
  return out;
}

let memberScale = 0.8;

function widthOf(m: Pick<Member, "pack" | "idle">, state: "idle" | "walk" | "play", sprite: Sprite): number {
  const fixed = m.pack.widths?.[state];
  const base = fixed ?? (sprite.w * IDLE_WIDTH) / m.idle.w;
  return base * memberScale;
}

function show(m: Member, state: "idle" | "walk" | "play", url?: string, flip?: 1 | -1) {
  const sprite = state === "walk" ? m.walk ?? m.idle : m[state];
  m.img.style.width = `${widthOf(m, state === "walk" && !m.walk ? "idle" : state, sprite)}px`;
  m.img.src = url ?? sprite.url;
  if (flip) m.img.style.setProperty("--flip", String(flip));
}

function walkSpeed(m: Member): number {
  return (packStride(m.pack) / 0.75) * memberScale;
}

// Walk to x with a CSS transition; long trips speed the gait up together
// with the travel so the feet keep matching the ground.
async function walkTo(m: Member, x: number, maxSeconds: number) {
  const distance = Math.abs(x - m.x);
  if (distance < 2) return;
  const base = walkSpeed(m);
  const hurry = Math.min(2.6, Math.max(1, distance / (base * maxSeconds)));
  const seconds = distance / (base * hurry);
  let url: string | undefined;
  if (m.walk) {
    const retimed = retimeApng(new Uint8Array(m.walk.bytes), hurry);
    url = URL.createObjectURL(new Blob([retimed], { type: "image/png" }));
  }
  show(m, "walk", url, x > m.x ? 1 : -1);
  m.el.style.transitionDuration = `${seconds}s`;
  m.el.style.left = `${x}px`;
  m.x = x;
  await sleep(seconds * 1000);
  m.el.style.transitionDuration = "0s";
  if (url) URL.revokeObjectURL(url);
}

function drawRiser(width: number) {
  const h = 64;
  const deck = 12;
  const speaker = (x: number) => `
    <g transform="translate(${x},${h - deck - 50})">
      <rect width="42" height="50" rx="6" fill="#2c2a33" stroke="#4a3426" stroke-width="2"/>
      <circle cx="21" cy="17" r="9" fill="#3d3a46" stroke="#17161b" stroke-width="2"/>
      <circle cx="21" cy="17" r="3.5" fill="#17161b"/>
      <circle cx="21" cy="37" r="5" fill="#3d3a46" stroke="#17161b" stroke-width="1.5"/>
    </g>`;
  const planks = Array.from({ length: Math.floor(width / 46) }, (_, i) =>
    `<line x1="${(i + 1) * 46}" y1="${h - deck + 3}" x2="${(i + 1) * 46}" y2="${h - 2}" stroke="#6e4a33" stroke-width="1.5"/>`,
  ).join("");
  riser.setAttribute("width", String(width));
  riser.setAttribute("viewBox", `0 0 ${width} ${h}`);
  riser.innerHTML = `
    ${speaker(4)}${speaker(width - 46)}
    <rect x="0" y="${h - deck}" width="${width}" height="${deck}" rx="5" fill="#a8734c" stroke="#4a3426" stroke-width="2"/>
    <rect x="2" y="${h - deck + 1}" width="${width - 4}" height="4" rx="2" fill="#c99467"/>
    ${planks}`;
}

let noteTimer: ReturnType<typeof setInterval> | null = null;

function startNotes(members: Member[]) {
  const colors = ["#ff7a59", "#5bb8ff", "#ffc93c", "#8bd96b", "#d58cff"];
  noteTimer = setInterval(() => {
    const m = members[Math.floor(Math.random() * members.length)];
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = ["♪", "♫", "♬"][Math.floor(Math.random() * 3)];
    note.style.color = colors[Math.floor(Math.random() * colors.length)];
    note.style.left = `${m.x + (Math.random() - 0.5) * 60}px`;
    note.style.bottom = `calc(var(--floor) + ${m.img.getBoundingClientRect().height * (0.6 + Math.random() * 0.3)}px)`;
    note.style.setProperty("--dx", `${(Math.random() - 0.5) * 50}px`);
    notesEl.appendChild(note);
    setTimeout(() => note.remove(), 2300);
  }, 380);
}

function hearts(members: Member[]) {
  for (const m of members) {
    for (let i = 0; i < 2; i++) {
      const h = document.createElement("span");
      h.className = "note";
      h.textContent = ["💖", "✨"][i];
      h.style.left = `${m.x + (Math.random() - 0.5) * 50}px`;
      h.style.bottom = `calc(var(--floor) + ${m.img.getBoundingClientRect().height * 0.8}px)`;
      h.style.setProperty("--dx", `${(Math.random() - 0.5) * 40}px`);
      h.style.animationDelay = `${i * 0.3}s`;
      notesEl.appendChild(h);
    }
  }
}

async function openControls(centerX: number, topY: number) {
  const w = 300;
  const px = Math.round(mon.x + (centerX - w / 2) * scale);
  const py = Math.round(topY);
  new WebviewWindow("band-ctl", {
    url: `band-ctl.html?px=${px}&py=${py}`,
    width: w,
    height: 52,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    resizable: false,
    focus: false,
    visible: false,
  });
}

async function finish() {
  if (noteTimer) clearInterval(noteTimer);
  await emit(BAND_ENDED, { x: null });
  const ctl = await WebviewWindow.getByLabel("band-ctl");
  await ctl?.close();
  await win.close();
}

async function run() {
  const floorPx = (mon.y + mon.h - (work.y + work.h)) / scale;
  const winTop = work.y + work.h - Math.round(ABOVE * scale);
  await win.setPosition(new PhysicalPosition(mon.x, winTop));
  await win.setSize(new PhysicalSize(mon.w, mon.y + mon.h - winTop));
  await win.setIgnoreCursorEvents(true);
  document.documentElement.style.setProperty("--floor", `${floorPx}px`);
  document.documentElement.style.setProperty("--drop", `${floorPx}px`);

  const loaded = await resolveMembers();
  const W = mon.w / scale;
  const s = loadSettings();
  memberScale = Math.min(1, Math.max(0.55, 0.78 * s.size));
  const playWidths = () =>
    loaded.map((m) => widthOf(m, "play", m.play) * SPACING);
  let total = playWidths().reduce((a, b) => a + b, 0);
  if (total > W * 0.86) {
    memberScale *= (W * 0.86) / total;
    total = playWidths().reduce((a, b) => a + b, 0);
  }
  const anchor = petOnFloor ? petLocalX : W / 2;
  const cx = Math.min(Math.max(anchor, total / 2 + 60), W - total / 2 - 60);

  let left = cx - total / 2;
  let petTaken = false;
  const members: Member[] = loaded.map((m, i) => {
    const w = playWidths()[i];
    const slotX = left + w / 2;
    left += w;
    const isPet = !petTaken && m.pack.id === petPack;
    if (isPet) petTaken = true;
    const el = document.createElement("div");
    el.className = "member";
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    el.appendChild(img);
    membersEl.appendChild(el);
    const idleW = widthOf(m, "idle", m.idle);
    const startX = isPet && petOnFloor
      ? petLocalX
      : slotX < cx || (slotX === cx && i % 2 === 0)
        ? -idleW
        : W + idleW;
    el.style.left = `${startX}px`;
    return { ...m, el, img, x: startX, slotX, isPet };
  });
  const pet = members.find((m) => m.isPet) ?? null;
  await emit(BAND_PET, { join: pet !== null });

  drawRiser(total + 120);
  riser.style.left = `${cx - (total + 120) / 2}px`;
  lights.style.left = `${cx - total * 0.75}px`;
  lights.style.width = `${total * 1.5}px`;

  for (const m of members) show(m, "idle", undefined, m.x < cx ? 1 : -1);
  await win.show();

  const tallest = Math.max(...members.map((m) => (widthOf(m, "play", m.play) / m.play.w) * m.play.h));
  void openControls(cx, winTop + (ABOVE - tallest - 64) * scale);

  // Walk in: the pet hops up onto the taskbar line first.
  await Promise.all(
    members.map(async (m, i) => {
      if (m.isPet && petOnFloor) {
        m.el.classList.add("hop-up");
        await sleep(500);
        m.el.classList.remove("hop-up");
      } else {
        await sleep(i * 220);
      }
      await walkTo(m, m.slotX, 5);
      show(m, "idle", undefined, m.slotX <= cx ? 1 : -1);
    }),
  );

  if (!stopRequested) {
    stage.classList.add("lit");
    await sleepUnlessStopped(800);
  }
  if (!stopRequested) {
    const t0 = Date.now() + 400;
    await emit(BAND_START, { t0 });
    await sleep(t0 - Date.now());
    for (const m of members) show(m, "play", undefined, 1);
    stage.classList.add("playing");
    startNotes(members);
    await sleepUnlessStopped(SONG_SECONDS * 1000);
    if (noteTimer) clearInterval(noteTimer);
    stage.classList.remove("playing");
    for (const m of members) {
      show(m, "idle", undefined, m.slotX <= cx ? 1 : -1);
      m.el.classList.add("bow");
    }
    hearts(members);
    await sleep(1600);
    for (const m of members) m.el.classList.remove("bow");
  }
  stage.classList.remove("lit");

  // Walk off: everyone to the nearest edge, the pet back to its spot.
  await Promise.all(
    members.map(async (m) => {
      if (m.isPet) {
        const home = petOnFloor ? petLocalX : m.slotX;
        await walkTo(m, home, 5);
        show(m, "idle");
        m.el.classList.add("hop-down");
        await sleep(450);
        m.el.style.visibility = "hidden";
        // The pet is back on screen before the others have left.
        await emit(BAND_ENDED, { x: mon.x + home * scale });
      } else {
        const w = widthOf(m, "idle", m.idle);
        await walkTo(m, m.x < cx ? -w : W + w, 5);
      }
    }),
  );
  await finish();
}

run().catch(async (err) => {
  console.error("band stage failed", err);
  await finish();
});
