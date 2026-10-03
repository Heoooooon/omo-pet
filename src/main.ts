import {
  getCurrentWindow,
  currentMonitor,
  availableMonitors,
  PhysicalPosition,
  LogicalPosition,
  LogicalSize,
  type Monitor,
} from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { initI18n, t } from "./i18n";
import { retimeApng } from "./apng";
import {
  getLicense,
  hasBand,
  LICENSE_EVENT,
  listUsablePacks,
  packStride,
  spriteUrl,
  type PackInfo,
} from "./packs";
import {
  BAND_ENDED,
  BAND_OPEN,
  BAND_PET,
  LAST_BAND_KEY,
} from "./band-shared";
import {
  DEFAULTS,
  loadSettings,
  SETTINGS_EVENT,
  type PetSettings,
} from "./settings-store";

const appWindow = getCurrentWindow();

// The original pet ("main") owns the iPad handoff; spawned friends are
// local-only and get a slightly different size and stride for personality.
const isMainPet = appWindow.label === "main";
const personality = isMainPet ? 1 : 0.72 + Math.random() * 0.36;

// User-tunable knobs from the settings panel, applied live.
let cfg: PetSettings = loadSettings();
const stage = document.getElementById("stage")!;
const pet = document.getElementById("pet") as HTMLImageElement;
const effects = document.getElementById("effects")!;
const menu = document.getElementById("menu")!;
const quitBtn = document.getElementById("quit")!;

type State =
  | "idle"
  | "walk"
  | "drag"
  | "react"
  | "fall"
  | "edge"
  | "rocket"
  | "jet";
let state: State = "idle";
let stateVersion = 0;
let walkTimer: ReturnType<typeof setTimeout> | null = null;
let walkFrame: (() => void) | null = null;
let fallFrame: (() => void) | null = null;
let edgeTimer: ReturnType<typeof setTimeout> | null = null;
let rocketFrame: (() => void) | null = null;
let jetFrame: (() => void) | null = null;

// Await each native move and tick: WebKit can throttle background timers
// to 1 Hz, so neither setInterval nor requestAnimationFrame is a motion clock.
function motionLoop(step: (dt: number) => Promise<void>): () => void {
  let active = true;
  let previous = performance.now();
  async function tick() {
    if (!active) return;
    const now = performance.now();
    const dt = Math.min(0.25, (now - previous) / 1000);
    previous = now;
    await step(dt);
    if (active) {
      await invoke("motion_tick");
      void tick();
    }
  }
  void tick();
  return () => { active = false; };
}

function easeMotion(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function walkSpeed(): number {
  // Six frames at 8 fps make one stride. Short-legged local packs take
  // smaller steps; zoom/personality scale the stride, not the cycle rate.
  const stride = currentPack === DEFAULTS.pack
    ? 56
    : packStride(packInfos.find((p) => p.id === currentPack));
  const rate = state === "walk"
    ? [...walkPlayback.values()].find(({ src }) => src === pet.src)?.speed ?? 1
    : cfg.speed;
  return (stride / 0.75) * scale * personality * cfg.size * rate;
}

// Character packs: each pack is a directory of per-state APNGs. A state
// without a (loaded) asset falls back to the pack's idle sprite; CSS
// keyframes still apply on top either way.
const ALL_STATES: readonly State[] = [
  "idle",
  "walk",
  "drag",
  "react",
  "fall",
  "edge",
  "rocket",
  "jet",
];

// One-shot APNGs (plays=1) need a cache-buster to replay on re-entry.
const ONE_SHOT: ReadonlySet<State> = new Set(["fall", "edge"]);

// Optional multi-phase variants a pack may ship (fall gets three phases:
// deploy one-shot → glide loop → landing one-shot).
const EXTRA_SPRITES = ["fall-open", "fall-glide", "fall-land"] as const;

// Each state can ship variants: <key>.apng (base) plus <key>.2.apng …
// <key>.4.apng. Entering a state picks one at random, so the same action
// doesn't always look identical.
const VARIANT_SUFFIXES = [2, 3, 4];
const spriteVariants = new Map<string, string[]>();
const walkPlayback = new Map<string, Readonly<{ speed: number; src: string }>>();
let currentPack = "";
let packInfos: PackInfo[] = []; // only the packs this computer may use
let bandOwned = false;

async function refreshEntitlements() {
  const [packs, lic] = await Promise.all([listUsablePacks(), getLicense()]);
  packInfos = packs;
  bandOwned = hasBand(lic);
}

// A saved choice that is no longer usable (paid pack without a license,
// deleted pack) falls back to the free default.
const allowedPack = (id: string) =>
  packInfos.some((p) => p.id === id) ? id : DEFAULTS.pack;

function packUrl(pack: string, key: string): string {
  return spriteUrl(pack, `${key}.apng`);
}

function loadPack(pack: string) {
  for (const { src } of walkPlayback.values()) URL.revokeObjectURL(src);
  walkPlayback.clear();
  currentPack = pack;
  document.body.dataset.pack = pack; // pack-specific CSS (per-state sizes)
  spriteVariants.clear();
  for (const key of [...ALL_STATES, ...EXTRA_SPRITES]) {
    document.body.classList.remove(`has-${key}`);
    probeSprite(pack, key, packUrl(pack, key), true);
    for (const v of VARIANT_SUFFIXES) {
      probeSprite(pack, key, spriteUrl(pack, `${key}.${v}.apng`), false);
    }
  }
  pet.src = packUrl(pack, "idle");
  // A saved pack that no longer exists (e.g. a removed local pack) falls
  // back to the bundled default instead of showing a broken image.
  pet.onload = () => {
    pet.onload = pet.onerror = null;
  };
  pet.onerror = () => {
    pet.onload = pet.onerror = null;
    if (currentPack === pack && pack !== DEFAULTS.pack) loadPack(DEFAULTS.pack);
  };
}

function probeSprite(pack: string, key: string, url: string, isBase: boolean) {
  const probe = new Image();
  probe.onload = () => {
    if (currentPack !== pack) return; // switched again while probing
    const list = spriteVariants.get(key) ?? [];
    if (isBase) list.unshift(url);
    else list.push(url);
    spriteVariants.set(key, list);
    if (isBase) {
      document.body.classList.add(`has-${key}`);
      if (state === key) pet.src = url; // refresh the visible sprite
    }
  };
  probe.src = url;
}

function spriteFor(target: string): string {
  const list = spriteVariants.get(target);
  if (list?.length) return list[Math.floor(Math.random() * list.length)];
  return spriteVariants.get("idle")?.[0] ?? packUrl(currentPack, "idle");
}

// APNG images have no playbackRate. Change only frame delays (and their
// PNG checksums) so speed tuning changes the drawn gait and travel together.
async function timedWalk(url: string, speed: number): Promise<string> {
  const cached = walkPlayback.get(url);
  if (cached?.speed === speed) return cached.src;
  const bytes = retimeApng(new Uint8Array(await (await fetch(url)).arrayBuffer()), speed);
  const src = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  const image = new Image();
  image.src = src;
  await image.decode();
  if (cached) URL.revokeObjectURL(cached.src);
  walkPlayback.set(url, { speed, src });
  return src;
}

function setState(next: State) {
  const changed = state !== next;
  if (changed || ONE_SHOT.has(next)) stateVersion += 1;
  if (changed) {
    walkFrame?.();
    fallFrame?.();
    rocketFrame?.();
    jetFrame?.();
    crossFrame?.();
  }
  state = next;
  document.body.dataset.state = next;
  delete document.body.dataset.fallPhase; // fall() re-tags its own phases
  if (!changed && !ONE_SHOT.has(next)) return; // keep the current variant
  const src = spriteFor(next);
  if (ONE_SHOT.has(next) && spriteVariants.has(next)) {
    pet.src = `${src}?t=${Date.now()}`;
  } else if (!pet.src.endsWith(src)) {
    pet.src = src;
  }
}

function setFlip(dir: -1 | 1) {
  pet.style.setProperty("--flip", String(dir));
}

// ---------- world geometry ----------
//
// The pet walks on "platforms": the top edges of other apps' windows
// (reported by the Rust `list_windows` command) plus the screen floor.
// All values below are physical pixels.

type Platform = { id: number | "floor"; x1: number; x2: number; y: number };

let scale = 2;
let winW = 440;
let winH = 480;
let monX = 0;
let monY = 0;
let monW = 0;
let monH = 0;
let windowPlatforms: Platform[] = [];
let standingOn: Platform | null = null;

function floorPlatform(): Platform {
  return { id: "floor", x1: monX, x2: monX + monW, y: monY + monH };
}

async function refreshMonitor() {
  const monitor = await currentMonitor();
  if (!monitor) return;
  scale = monitor.scaleFactor;
  monX = monitor.position.x;
  monY = monitor.position.y;
  monW = monitor.size.width;
  monH = monitor.size.height;
  const size = await appWindow.outerSize();
  winW = size.width;
  winH = size.height;
}

async function refreshPlatforms() {
  try {
    const wins = await invoke<
      { id: number; x: number; y: number; width: number; height: number }[]
    >("list_windows");
    windowPlatforms = wins
      .map((w) => ({
        id: w.id,
        x1: Math.round(w.x * scale),
        x2: Math.round((w.x + w.width) * scale),
        y: Math.round(w.y * scale),
      }))
      .filter((p) => p.x2 - p.x1 >= winW) // wide enough to stand on
      .filter((p) => p.y - winH > monY) // headroom below the menu bar
      .filter((p) => p.y < monY + monH - 12); // meaningfully above the floor
  } catch {
    windowPlatforms = [];
  }
}

// Highest surface below the given feet line at horizontal center cx.
function surfaceBelow(cx: number, feetY: number): Platform {
  let best = floorPlatform();
  for (const p of windowPlatforms) {
    if (cx < p.x1 || cx > p.x2) continue;
    if (p.y < feetY - 4) continue; // above us — not a landing surface
    if (p.y < best.y) best = p;
  }
  return best;
}

// ---------- gravity ----------

// Land on the surface below if airborne, otherwise rest where we are.
async function settle() {
  await refreshMonitor(); // the pet may have been dropped on another monitor
  const pos = await appWindow.outerPosition();
  const feet = pos.y + winH;
  const cx = pos.x + winW / 2;
  const target = surfaceBelow(cx, feet);
  if (target.y - feet > 10) {
    void fall(pos.y);
  } else {
    standingOn = target;
    await appWindow.setPosition(new PhysicalPosition(pos.x, target.y - winH));
    setState("idle");
    scheduleNext();
  }
}

async function fall(startY: number) {
  fallFrame?.();
  setState("fall");
  const version = stateVersion;
  // Three-phase parachute when the pack ships the variants: deploy
  // (one-shot) → glide (loop) → landing (one-shot). Otherwise the single
  // fall sequence plays as before.
  const phased =
    spriteVariants.has("fall-open") && spriteVariants.has("fall-glide");
  if (phased) {
    pet.src = `${spriteFor("fall-open")}?t=${Date.now()}`;
    document.body.dataset.fallPhase = "open";
  }
  let gliding = false;

  const x = (await appWindow.outerPosition()).x; // x is fixed while falling
  const cx = x + winW / 2;
  const gravity = 2600; // physical px/s², freefall
  const chuteDelayMs = 550; // parachute opens near the end of the APNG
  const drift = 260; // physical px/s descent under parachute
  let y = startY;
  let vy = 0;
  let elapsed = 0;

  fallFrame = motionLoop(async (dt) => {
    if (state !== "fall") return stopFall();
    elapsed += dt * 1000;
    if (elapsed < chuteDelayMs) {
      vy += gravity * dt;
    } else {
      vy = drift + (vy - drift) * Math.exp(-14 * dt);
      if (phased && !gliding) {
        gliding = true;
        pet.src = spriteFor("fall-glide");
        document.body.dataset.fallPhase = "glide";
      }
    }
    // Re-target every tick so windows moving or closing mid-fall are
    // handled: she lands on whatever is actually below her feet.
    const target = surfaceBelow(cx, y + winH);
    const restY = target.y - winH;
    y = Math.min(restY, y + vy * dt);
    await appWindow.setPosition(new PhysicalPosition(x, Math.round(y)));
    if (stateVersion !== version) return;
    if (y >= restY) {
      stopFall();
      standingOn = target;
      if (phased && spriteVariants.has("fall-land")) {
        pet.src = `${spriteFor("fall-land")}?t=${Date.now()}`;
        document.body.dataset.fallPhase = "land";
        void invoke("motion_tick", { durationMs: 450 }).then(() => {
          if (stateVersion !== version) return; // grabbed during touchdown
          setState("idle");
          scheduleNext();
        });
      } else {
        setState("idle");
        scheduleNext();
      }
    }
  });
}

function stopFall() {
  fallFrame?.();
  fallFrame = null;
}

// ---------- idle scheduler ----------

function scheduleNext() {
  if (walkTimer) clearTimeout(walkTimer);
  walkTimer = setTimeout(
    async () => {
      if (state !== "idle" || bandActive) return scheduleNext();
      if (bandDue() && Math.random() < 0.004) return void openBand();
      const roll = Math.random();
      const stunt = 0.12 * cfg.stunts;
      if (roll < stunt && spriteVariants.has("rocket")) {
        // A display above turns half the launches into a trip upstairs.
        const above = cfg.crossMonitors
          ? await verticalNeighbor(-1)
          : undefined;
        if (above && Math.random() < 0.5) void crossVertical(above, -1);
        else void rocketLaunch();
      } else if (roll < stunt * 2 && spriteVariants.has("jet")) {
        void jetDash();
      } else if (roll < stunt * 2 + 0.1 && cfg.crossMonitors) {
        // Dive off the bottom of this screen when another sits below.
        const below = await verticalNeighbor(1);
        if (below) void crossVertical(below, 1);
        else walk();
      } else if (roll < 0.8) {
        walk();
      } else {
        scheduleNext();
      }
    },
    (2000 + Math.random() * 3000) / cfg.activity,
  );
}

// ---------- jet: hop on a rocket and blast sideways across the screen ----------

async function jetDash() {
  if (state !== "idle") return scheduleNext();
  const pos = await appWindow.outerPosition();
  const minX = monX;
  const maxX = monX + monW - winW;

  // Only bother for a proper dash — short hops are what walking is for.
  let targetX = Math.round(minX + Math.random() * (maxX - minX));
  if (Math.abs(targetX - pos.x) < monW * 0.35) {
    targetX = pos.x < (minX + maxX) / 2 ? maxX : minX;
  }
  const dir: -1 | 1 = targetX > pos.x ? 1 : -1;
  const cruiseY = Math.max(
    monY + Math.round(40 * scale),
    pos.y - Math.round((60 + Math.random() * 160) * scale),
  );

  standingOn = null;
  setFlip(dir);
  setState("jet");
  const version = stateVersion;

  const duration = Math.max(1.1, Math.abs(targetX - pos.x) / (700 * scale) * 1.5);
  let y = pos.y;
  let t = 0;

  jetFrame = motionLoop(async (dt) => {
    if (state !== "jet") return stopJet();
    t += dt;
    const progress = Math.min(1, t / duration);
    const eased = easeMotion(progress);
    const x = pos.x + (targetX - pos.x) * eased;
    y = pos.y + (cruiseY - pos.y) * eased
      + Math.sin(t * 5.5) * 7 * scale * Math.sin(Math.PI * progress) ** 2;
    const arrived = progress === 1;
    if (arrived) {
      stopJet();
      await appWindow.setPosition(
        new PhysicalPosition(targetX, Math.round(y)),
      );
      if (stateVersion !== version) return;
      void fall(Math.round(y)); // dismount → parachute
      return;
    }
    await appWindow.setPosition(
      new PhysicalPosition(Math.round(x), Math.round(y)),
    );
  });
}

function stopJet() {
  jetFrame?.();
  jetFrame = null;
}

// ---------- rocket: blast off, cut the engine, parachute down ----------

async function rocketLaunch() {
  if (state !== "idle") return scheduleNext();
  const pos = await appWindow.outerPosition();
  const feet = pos.y + winH;

  // Aim for a window platform well above us when one exists; otherwise
  // fly to the top of the screen. Either way the landing is the existing
  // parachute drop, which re-targets whatever is below on the way down.
  const high = windowPlatforms.filter(
    (p) => p.y < feet - winH * 1.2 && p.x2 - p.x1 >= winW,
  );
  const target =
    high.length && Math.random() < 0.7
      ? high[Math.floor(Math.random() * high.length)]
      : null;
  const startX = pos.x;
  const targetX = target
    ? Math.round(
        Math.min(
          Math.max(platformCenterX(target) - winW / 2, target.x1),
          target.x2 - winW,
        ),
      )
    : startX;
  const apexY = target
    ? target.y - winH - Math.round(60 * scale) // overshoot, then drop onto it
    : monY + Math.round(16 * scale);

  standingOn = null;
  if (targetX !== startX) setFlip(targetX > startX ? 1 : -1);
  setState("rocket");
  const version = stateVersion;
  document.body.classList.add("ignite");
  await invoke("motion_tick", { durationMs: 650 });
  document.body.classList.remove("ignite");
  if (stateVersion !== version) return; // interrupted or re-entered during ignition

  let t = 0;
  const climb = Math.max(1, pos.y - apexY);
  const duration = Math.max(1.2, climb / (900 * scale) * 1.5);

  rocketFrame = motionLoop(async (dt) => {
    if (state !== "rocket") return stopRocket();
    t += dt;
    const progress = Math.min(1, t / duration);
    const eased = easeMotion(progress);
    const y = pos.y + (apexY - pos.y) * eased;
    const x = Math.round(startX + (targetX - startX) * eased);
    if (progress === 1) {
      stopRocket();
      await appWindow.setPosition(new PhysicalPosition(x, apexY));
      if (stateVersion !== version) return;
      void fall(apexY); // engine cut → parachute
      return;
    }
    await appWindow.setPosition(new PhysicalPosition(x, Math.round(y)));
  });
}

function platformCenterX(p: Platform): number {
  return p.x1 + (p.x2 - p.x1) / 2;
}

function stopRocket() {
  rocketFrame?.();
  rocketFrame = null;
  document.body.classList.remove("ignite");
}

// ---------- walking ----------

async function walk() {
  if (state !== "idle") return scheduleNext();
  const idleVersion = stateVersion;
  const tuning = cfg;
  const pack = currentPack;
  const p = standingOn ?? floorPlatform();
  standingOn = p;

  const pos = await appWindow.outerPosition();
  const timed = tuning.speed !== 1 && spriteVariants.has("walk");
  const src = timed ? await timedWalk(spriteFor("walk"), tuning.speed) : "";
  if (stateVersion !== idleVersion || pressed) return;
  if (cfg !== tuning || currentPack !== pack) return scheduleNext();
  const minX = Math.max(p.x1, monX);
  const maxX = Math.min(p.x2, monX + monW) - winW;
  if (maxX <= minX) return scheduleNext();

  // Sometimes head straight for a corner to climb up and sit on it.
  let targetX = Math.round(minX + Math.random() * (maxX - minX));
  if (Math.random() < 0.35) targetX = Math.random() < 0.5 ? minX : maxX;
  const dir: -1 | 1 = targetX > pos.x ? 1 : -1;
  const speed = walkSpeed();
  const acceleration = speed / 0.24;
  const edgeZone = Math.round(16 * scale);

  setFlip(dir);
  setState("walk");
  if (timed) pet.src = src;
  const version = stateVersion;

  let x = pos.x;
  let velocity = 0;
  walkFrame = motionLoop(async (dt) => {
    if (state !== "walk") return stopWalk();
    const previous = velocity;
    const desired = Math.min(speed, Math.sqrt(2 * acceleration * Math.abs(targetX - x)));
    velocity += Math.max(-acceleration * dt, Math.min(acceleration * dt, desired - velocity));
    x += (previous + velocity) / 2 * dt * dir;
    const arrived = (dir === 1 && x >= targetX) || (dir === -1 && x <= targetX);
    if (arrived) x = targetX;
    await appWindow.setPosition(new PhysicalPosition(Math.round(x), p.y - winH));
    if (stateVersion !== version) return;
    if (!arrived) return;
    walkFrame?.();
    walkFrame = null;
    if (x - minX <= edgeZone) void arriveAtEnd(-1);
    else if (maxX - x <= edgeZone) void arriveAtEnd(1);
    else {
      setState("idle");
      scheduleNext();
    }
  });
}

// Reaching the end of a platform: on the floor, cross into an adjacent
// monitor when one exists, then try handing off to the iPad via Lanbeam;
// otherwise climb up and sit on the corner.
async function arriveAtEnd(dir: -1 | 1) {
  if (standingOn?.id === "floor") {
    if (cfg.crossMonitors) {
      const next = await adjacentMonitor(dir);
      if (next) return crossTo(next, dir);
    }
    if (cfg.ipadHandoff && (await tryCrossToIPad(dir))) return;
  }
  enterEdge(dir);
}

// ---------- Lanbeam handoff: the pet can move to the paired iPad ----------

type PetBridgeState = {
  location: "mac" | "ios";
  entryEdge?: "left" | "right" | null;
  sequence: number;
  updatedAt: string;
};

let bridgeSequence = -1; // last handoff sequence this side has processed
let awayPoll: ReturnType<typeof setInterval> | null = null;

// Walking off the Mac's right edge enters the iPad from its left, and
// vice versa — the iPad behaves like an adjacent display.
async function tryCrossToIPad(dir: -1 | 1): Promise<boolean> {
  if (!isMainPet) return false; // 친구들은 Mac에 남는다
  try {
    const raw = await invoke<string>("pet_bridge_handoff", {
      to: "ios",
      entryEdge: dir === 1 ? "left" : "right",
    });
    bridgeSequence = (JSON.parse(raw) as PetBridgeState).sequence;
  } catch {
    return false; // agent not running or no bridge — stay on the Mac
  }
  await goAway();
  return true;
}

// Hide while the pet lives on the iPad; poll the bridge for its return.
async function goAway() {
  if (walkTimer) clearTimeout(walkTimer);
  if (edgeTimer) clearTimeout(edgeTimer);
  setState("idle");
  await appWindow.hide();
  let failures = 0;
  awayPoll = setInterval(async () => {
    try {
      const raw = await invoke<string>("pet_bridge_state");
      const st = JSON.parse(raw) as PetBridgeState;
      failures = 0;
      if (st.location === "mac" && st.sequence > bridgeSequence) {
        bridgeSequence = st.sequence;
        stopAwayPoll();
        await comeBack(st.entryEdge === "right" ? "right" : "left");
      }
    } catch {
      // Agent quit while the pet was away — after ~15s give up and return.
      failures += 1;
      if (failures >= 15) {
        stopAwayPoll();
        await comeBack("right");
      }
    }
  }, 1000);
}

function stopAwayPoll() {
  if (awayPoll) clearInterval(awayPoll);
  awayPoll = null;
}

async function comeBack(edge: "left" | "right") {
  await refreshMonitor();
  standingOn = floorPlatform();
  const x = edge === "left" ? monX + 8 : monX + monW - winW - 8;
  await appWindow.setPosition(new PhysicalPosition(x, monY + monH - winH));
  setFlip(edge === "left" ? 1 : -1); // face into the screen
  await appWindow.show();
  setState("idle");
  scheduleNext();
}

// If the app starts while the pet is already on the iPad, stay hidden.
async function syncBridgeAtStartup() {
  if (!isMainPet) return;
  try {
    const raw = await invoke<string>("pet_bridge_state");
    const st = JSON.parse(raw) as PetBridgeState;
    bridgeSequence = st.sequence;
    void pushSettingsToBridge(); // the agent may hold stale (or no) tuning
    if (st.location === "ios") await goAway();
  } catch {
    // no agent — purely local pet
  }
}

// Monitors disagree about physical pixels when their scale factors differ
// (a 2x built-in next to a 1x external), so adjacency and the crossing
// animation both work in the logical point space macOS arranges displays in.
function logicalRect(m: Monitor) {
  const s = m.scaleFactor;
  return {
    x: m.position.x / s,
    y: m.position.y / s,
    w: m.size.width / s,
    h: m.size.height / s,
  };
}

async function adjacentMonitor(dir: -1 | 1): Promise<Monitor | undefined> {
  try {
    const monitors = await availableMonitors();
    const cur = {
      x: monX / scale,
      y: monY / scale,
      w: monW / scale,
      h: monH / scale,
    };
    const boundary = dir === 1 ? cur.x + cur.w : cur.x;
    return monitors.find((m) => {
      const r = logicalRect(m);
      if (Math.abs(r.x - cur.x) < 1 && Math.abs(r.y - cur.y) < 1) return false; // self
      const overlapsY = r.y < cur.y + cur.h && r.y + r.h > cur.y;
      if (!overlapsY) return false;
      return dir === 1
        ? Math.abs(r.x - boundary) <= 16
        : Math.abs(r.x + r.w - boundary) <= 16;
    });
  } catch {
    return undefined;
  }
}

let crossFrame: (() => void) | null = null;

function stopCross() {
  crossFrame?.();
  crossFrame = null;
}

// A display stacked directly above (-1) or below (1) the current one whose
// horizontal span covers the pet's position, judged in logical points.
async function verticalNeighbor(dir: -1 | 1): Promise<Monitor | undefined> {
  try {
    const pos = await appWindow.outerPosition();
    const x = pos.x / scale;
    const lw = winW / scale;
    const cur = { y: monY / scale, h: monH / scale };
    const boundary = dir === 1 ? cur.y + cur.h : cur.y;
    const monitors = await availableMonitors();
    return monitors.find((m) => {
      const r = logicalRect(m);
      const touches =
        dir === 1
          ? Math.abs(r.y - boundary) <= 16
          : Math.abs(r.y + r.h - boundary) <= 16;
      if (!touches) return false;
      // She keeps her x while crossing, so the spot must exist over there.
      return x >= r.x - 40 && x + lw <= r.x + r.w + 40;
    });
  } catch {
    return undefined;
  }
}

// Cross into a display stacked above or below: dive off the bottom of the
// upper screen under the parachute, or rocket up through the top into the
// screen above. Animated in logical points like crossTo.
async function crossVertical(m: Monitor, dir: -1 | 1) {
  const pos = await appWindow.outerPosition();
  const lw = winW / scale;
  const lh = winH / scale;
  let x = pos.x / scale;
  let y = pos.y / scale;
  const r = logicalRect(m);
  const targetX = Math.min(Math.max(x, r.x + 8), r.x + r.w - lw - 8);
  // Far enough into the new screen for currentMonitor() to agree, then the
  // regular parachute drop finds whatever is below her feet over there.
  const arriveY =
    dir === 1 ? r.y + 8 : Math.max(r.y + 24, r.y + r.h - lh - 180);

  const arrive = async () => {
    stopCross();
    await refreshMonitor();
    await refreshPlatforms();
    standingOn = null;
    void fall(Math.round(y * scale));
  };

  standingOn = null;
  if (targetX !== x) setFlip(targetX > x ? 1 : -1);
  if (dir === -1) {
    setState("rocket");
    const version = stateVersion;
    document.body.classList.add("ignite");
    await invoke("motion_tick", { durationMs: 650 });
    document.body.classList.remove("ignite");
    if (stateVersion !== version) return;
  } else {
    setState("fall");
  }

  const version = stateVersion;
  let vy = 0;
  let elapsed = 0;
  crossFrame = motionLoop(async (dt) => {
    if (state !== (dir === -1 ? "rocket" : "fall")) return stopCross();
    elapsed += dt * 1000;
    if (dir === -1) {
      vy = Math.min(vy + 1700 * dt, 1200); // logical pt/s, upward
      y -= vy * dt;
    } else {
      // Freefall off the edge, then the chute opens and brakes the drop.
      if (elapsed < 550) vy += 1300 * dt;
      else vy = 300 + (vy - 300) * Math.exp(-14 * dt);
      y += vy * dt;
    }
    x += (targetX - x) * (1 - Math.exp(-3.2 * dt));
    const arrived = dir === -1 ? y <= arriveY : y >= arriveY;
    await appWindow.setPosition(new LogicalPosition(x, y));
    if (stateVersion !== version) return;
    if (arrived) await arrive();
  });
}

// Cross into the adjacent monitor without teleporting. Floors rarely line
// up across displays: onto a lower floor she walks over the boundary and
// parachutes down; onto a higher one she rides the jet up and over.
async function crossTo(m: Monitor, dir: -1 | 1) {
  const pos = await appWindow.outerPosition();
  const lw = winW / scale;
  const lh = winH / scale;
  let x = pos.x / scale;
  let y = pos.y / scale;
  const r = logicalRect(m);
  const endX = dir === 1 ? r.x + 8 : r.x + r.w - lw - 8;
  const floorTop = r.y + r.h - lh; // window y when standing on the new floor
  const climbing = floorTop < y - 8;
  const cruiseY = floorTop - 110; // enough headroom to parachute onto the floor
  const speed = walkSpeed() / scale; // logical pt/s

  const arrive = async () => {
    stopCross();
    await refreshMonitor(); // the window sits on the new monitor now
    await refreshPlatforms(); // platform px depend on the monitor's scale
    standingOn = null;
    if (climbing) void fall(Math.round(y * scale));
    else void settle(); // level floor rests in place, lower floor parachutes
  };

  setFlip(dir);
  setState(climbing ? "jet" : "walk");
  const version = stateVersion;

  let vx = 0;
  let t = 0;
  crossFrame = motionLoop(async (dt) => {
    if (state !== (climbing ? "jet" : "walk")) return stopCross();
    let arrived = false;
    if (climbing) {
      t += dt;
      // Climb first so she never dips below the taller monitor's visible
      // area, then cruise sideways over the boundary.
      y += (cruiseY - y) * (1 - Math.exp(-3.9 * dt));
      if (y - cruiseY < 40) {
        const desired = Math.min(1300, Math.sqrt(5200 * Math.abs(endX - x)));
        vx += Math.max(-2600 * dt, Math.min(2600 * dt, desired - vx));
        x += dir * vx * dt;
      }
    } else {
      const acceleration = speed / 0.24;
      const desired = Math.min(speed, Math.sqrt(2 * acceleration * Math.abs(endX - x)));
      vx += Math.max(-acceleration * dt, Math.min(acceleration * dt, desired - vx));
      x += vx * dt * dir;
    }
    if ((dir === 1 && x >= endX) || (dir === -1 && x <= endX)) {
      x = endX;
      arrived = true;
    }
    await appWindow.setPosition(new LogicalPosition(x, y));
    if (stateVersion !== version) return;
    if (arrived) await arrive();
  });
}

function stopWalk() {
  walkFrame?.();
  walkFrame = null;
  if (state === "walk") setState("idle");
  scheduleNext();
}

// Climb up and sit on the corner for a while. On a window, leaving the
// corner means hopping off and parachuting down; on the floor, just idle.
function enterEdge(dir: -1 | 1) {
  setFlip(dir);
  setState("edge");
  if (edgeTimer) clearTimeout(edgeTimer);
  edgeTimer = setTimeout(
    () => {
      if (state !== "edge") return;
      if (standingOn && standingOn.id !== "floor") {
        setState("idle");
        void hopOff(dir);
      } else {
        setState("idle");
        scheduleNext();
      }
    },
    4000 + Math.random() * 4000,
  );
}

async function hopOff(dir: -1 | 1) {
  const pos = await appWindow.outerPosition();
  const distance = dir * Math.round(winW * 0.6);
  standingOn = null;
  setFlip(dir);
  setState("walk");
  const version = stateVersion;
  let elapsed = 0;
  crossFrame = motionLoop(async (dt) => {
    if (state !== "walk") return stopCross();
    elapsed += dt;
    const progress = Math.min(1, elapsed / 0.35);
    const x = pos.x + distance * easeMotion(progress);
    const y = pos.y - Math.sin(Math.PI * progress) ** 2 * 12 * scale;
    await appWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
    if (stateVersion !== version) return;
    if (progress === 1) {
      stopCross();
      void settle();
    }
  });
}

// ---------- stranded-window watchdog ----------
//
// Rearranging displays can leave the window outside every screen (macOS
// keeps the stale coordinates). If the pet is nowhere visible, drop her
// back onto the primary monitor's floor.
async function recoverIfStranded() {
  if (state === "drag" || awayPoll || bandActive) return; // hidden-on-iPad has its own flow
  try {
    const monitors = await availableMonitors();
    if (!monitors.length) return;
    const pos = await appWindow.outerPosition();
    const cx = (pos.x + winW / 2) / scale;
    const cy = (pos.y + winH / 2) / scale;
    const visible = monitors.some((m) => {
      const r = logicalRect(m);
      return (
        cx >= r.x - 100 &&
        cx <= r.x + r.w + 100 &&
        cy >= r.y - 400 && // rockets legitimately overshoot the top
        cy <= r.y + r.h + 100
      );
    });
    if (visible) return;
    const primary =
      monitors.find((m) => m.position.x === 0 && m.position.y === 0) ??
      monitors[0];
    const r = logicalRect(primary);
    stopWalk();
    stopFall();
    stopRocket();
    stopJet();
    stopCross();
    await appWindow.setPosition(
      new LogicalPosition(r.x + r.w / 2, r.y + r.h - winH / scale),
    );
    await appWindow.show();
    await refreshMonitor();
    standingOn = floorPlatform();
    setState("idle");
    scheduleNext();
  } catch {
    // monitor enumeration hiccup — try again next tick
  }
}
setInterval(() => void recoverIfStranded(), 5000);

// ---------- support check: react when windows move or close ----------

setInterval(async () => {
  if (!standingOn || standingOn.id === "floor") return;
  if (state === "drag" || state === "fall" || state === "react") return;
  const fresh = windowPlatforms.find((w) => w.id === standingOn!.id);
  const pos = await appWindow.outerPosition();
  const cx = pos.x + winW / 2;
  if (!fresh || cx < fresh.x1 || cx > fresh.x2) {
    if (walkFrame) {
      walkFrame();
      walkFrame = null;
    }
    void settle(); // ground vanished from under her feet
    return;
  }
  // Ride the window: mutate in place so an in-flight walk sees the move.
  standingOn.x1 = fresh.x1;
  standingOn.x2 = fresh.x2;
  standingOn.y = fresh.y;
  const restY = fresh.y - winH;
  if ((state === "idle" || state === "edge") && Math.abs(pos.y - restY) > 2) {
    await appWindow.setPosition(new PhysicalPosition(pos.x, restY));
  }
}, 400);

// ---------- drag vs click ----------

let pressed = false;
let dragging = false;
let downX = 0;
let downY = 0;
let dragEndTimer: ReturnType<typeof setTimeout> | null = null;

stage.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  // Clicks inside the menu must reach the buttons — hiding the menu on
  // mousedown would remove the target before its click event fires.
  if (menu.contains(e.target as Node)) return;
  menu.hidden = true;
  if (state === "fall" || state === "rocket" || state === "jet") {
    stateVersion += 1; // cancel pending ignition/touchdown, even before dragging
    stopCross();
  }
  if (state === "fall") stopFall(); // caught mid-air
  if (state === "rocket") stopRocket(); // plucked off the rocket
  if (state === "jet") stopJet();
  pressed = true;
  dragging = false;
  downX = e.screenX;
  downY = e.screenY;
});

stage.addEventListener("mousemove", (e) => {
  if (!pressed || dragging) return;
  const moved = Math.hypot(e.screenX - downX, e.screenY - downY);
  if (moved > 5) {
    dragging = true;
    if (walkFrame) stopWalk();
    setState("drag");
    appWindow.startDragging();
  }
});

stage.addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !pressed) return;
  pressed = false;
  if (!dragging) react();
});

// While the OS drag loop runs, the webview gets no mouseup — end the
// drag pose once move events stop arriving.
appWindow.onMoved(() => {
  if (state !== "drag") return;
  if (dragEndTimer) clearTimeout(dragEndTimer);
  dragEndTimer = setTimeout(() => {
    pressed = false;
    dragging = false;
    if (state === "drag") void settle();
  }, 250);
});

// ---------- click reaction ----------

function react() {
  if (state === "walk" && walkFrame) stopWalk();
  setState("react");
  for (let i = 0; i < 3; i++) spawnHeart();
  pet.addEventListener(
    "animationend",
    () => {
      if (state === "react") void settle();
    },
    { once: true },
  );
}

function spawnHeart() {
  const heart = document.createElement("span");
  heart.className = "heart";
  heart.textContent = ["💖", "✨", "🌸"][Math.floor(Math.random() * 3)];
  heart.style.left = `${30 + Math.random() * 40}%`;
  heart.style.bottom = `${45 + Math.random() * 25}%`;
  heart.style.animationDelay = `${Math.random() * 0.25}s`;
  effects.appendChild(heart);
  setTimeout(() => heart.remove(), 1600);
}

// ---------- context menu (quit) ----------

stage.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  menu.hidden = !menu.hidden;
});

quitBtn.addEventListener("click", () => appWindow.close());

// ---------- spawn friends ----------

const friendBtn = document.getElementById("friend")!;
let friendsSpawned = 0;

friendBtn.addEventListener("click", () => {
  menu.hidden = true;
  if (friendsSpawned >= 3) return; // enough chaos per window
  friendsSpawned += 1;
  const label = `pet-${Date.now().toString(36)}-${friendsSpawned}`;
  new WebviewWindow(label, {
    url: "index.html",
    width: 240,
    height: 320,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    resizable: false,
    acceptFirstMouse: true,
  });
});

// ---------- settings panel ----------

const settingsBtn = document.getElementById("settings-open")!;

settingsBtn.addEventListener("click", () => {
  menu.hidden = true;
  void openSettings();
});

async function openSettings(tab?: string) {
  const existing = await WebviewWindow.getByLabel("settings");
  if (existing) {
    if (tab) await emit("settings-tab", tab);
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow("settings", {
    url: tab ? `settings.html?tab=${tab}` : "settings.html",
    title: t("settingsTitle"),
    width: 360,
    height: 620,
    resizable: false,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: true,
    acceptFirstMouse: true,
  });
}

// ---------- band mode ----------
//
// The band plays in its own stage window on the pet's monitor. When the
// pet's own pack is a band member, the pet hides and its stage double walks
// out from the same spot, then hands back where it ends up.

let bandActive = false;
let bandOpenedAt = 0;
let hiddenForBand = false;
const appStartedAt = Date.now();

function bandDue(): boolean {
  if (!isMainPet || !bandOwned || !cfg.bandRandom) return false;
  const last = Number(localStorage.getItem(LAST_BAND_KEY) ?? 0);
  return Date.now() - appStartedAt > 20 * 60e3 && Date.now() - last > 45 * 60e3;
}

async function openBand() {
  if (!isMainPet || bandActive || awayPoll) return;
  if (!bandOwned) return void openSettings("band"); // shows what the band pack unlocks
  if (await WebviewWindow.getByLabel("band-stage")) return;
  const monitor = await currentMonitor();
  if (!monitor) return;
  bandActive = true;
  bandOpenedAt = Date.now();
  localStorage.setItem(LAST_BAND_KEY, String(bandOpenedAt));
  menu.hidden = true;
  if (walkTimer) clearTimeout(walkTimer);
  if (edgeTimer) clearTimeout(edgeTimer);
  stopWalk();
  stopFall();
  stopRocket();
  stopJet();
  stopCross();
  setState("idle");
  await refreshMonitor();
  const pos = await appWindow.outerPosition();
  const params = new URLSearchParams({
    petPack: cfg.pack,
    petX: String(Math.round(pos.x + winW / 2)),
    petOnFloor: standingOn?.id === "floor" ? "1" : "0",
    mx: String(monitor.position.x),
    my: String(monitor.position.y),
    mw: String(monitor.size.width),
    mh: String(monitor.size.height),
    wy: String(monitor.workArea.position.y),
    wh: String(monitor.workArea.size.height),
    scale: String(monitor.scaleFactor),
  });
  new WebviewWindow("band-stage", {
    url: `band.html?${params}`,
    width: 400,
    height: 300,
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

async function endBand(x: number | null) {
  if (!bandActive) return;
  bandActive = false;
  if (hiddenForBand) {
    hiddenForBand = false;
    await refreshMonitor();
    if (x !== null) {
      const px = Math.round(Math.min(Math.max(x - winW / 2, monX), monX + monW - winW));
      await appWindow.setPosition(new PhysicalPosition(px, monY + monH - winH));
      standingOn = floorPlatform();
    }
    await appWindow.show();
  }
  setState("idle");
  scheduleNext();
}

if (isMainPet) {
  void listen(BAND_OPEN, () => void openBand());
  void listen("settings-open", () => void openSettings());
  void listen<{ join: boolean }>(BAND_PET, async (e) => {
    if (!bandActive || !e.payload.join) return;
    hiddenForBand = true;
    await appWindow.hide();
  });
  void listen<{ x: number | null }>(BAND_ENDED, (e) => void endBand(e.payload.x));
  // The stage window can vanish without saying goodbye (crash, dev reload).
  setInterval(async () => {
    if (!bandActive || Date.now() - bandOpenedAt < 8000) return;
    if (!(await WebviewWindow.getByLabel("band-stage"))) void endBand(null);
  }, 3000);
}

const bandBtn = document.getElementById("band")!;
bandBtn.hidden = !isMainPet;
bandBtn.addEventListener("click", () => {
  menu.hidden = true;
  void openBand();
});

// ---------- debug overlay toggle ----------

const debugBtn = document.getElementById("debug-toggle")!;
let debugShown = false;

function renderDebugButton() {
  debugBtn.textContent = t(debugShown ? "hideOverlay" : "showOverlay");
  if (isMainPet) {
    void invoke("set_tray_labels", {
      band: t("band"),
      settings: t("settings"),
      quit: t("quit"),
    }).catch(() => undefined);
  }
}

initI18n(renderDebugButton);

// One overlay per monitor, spawned lazily on first toggle. Each gets its
// monitor's logical rect in the query string and draws in local coords.
async function setDebugShown(shown: boolean) {
  debugShown = shown;
  try {
    const monitors = await availableMonitors();
    for (let i = 0; i < monitors.length; i++) {
      const m = monitors[i];
      const label = `debug-${i}`;
      const overlay = await WebviewWindow.getByLabel(label);
      if (overlay) {
        if (debugShown) await overlay.show();
        else await overlay.hide();
      } else if (debugShown) {
        const r = logicalRect(m);
        new WebviewWindow(label, {
          url: `debug.html?ox=${r.x}&oy=${r.y}&lh=${r.h}`,
          x: r.x,
          y: r.y,
          width: r.w,
          height: r.h,
          transparent: true,
          decorations: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          shadow: false,
          resizable: false,
          focus: false,
        });
      }
    }
  } catch {
    // monitor enumeration failed — leave whatever overlays exist as-is
  }
  renderDebugButton();
}

debugBtn.addEventListener("click", async () => {
  await setDebugShown(!debugShown);
  menu.hidden = true;
});

// Overlays are separate windows and survive a dev reload — start hidden
// so the toggle state and what's on screen never disagree.
if (isMainPet) void setDebugShown(false);

// ---------- startup: sit at the bottom center of the screen ----------

// Scale the pet and, above 100%, the window that carries her. Physics
// reads winW/winH back from the OS so it follows automatically.
async function applyPetSize() {
  (pet.style as CSSStyleDeclaration & { zoom: string }).zoom = String(
    personality * cfg.size,
  );
  const k = Math.max(1, cfg.size);
  await appWindow.setSize(
    new LogicalSize(Math.round(240 * k), Math.round(320 * k)),
  );
}

void listen<PetSettings>(SETTINGS_EVENT, async (e) => {
  const sizeChanged = e.payload.size !== cfg.size;
  const packChanged = e.payload.pack !== cfg.pack;
  cfg = e.payload;
  if (packChanged) await refreshEntitlements();
  void pushSettingsToBridge();
  if (packChanged) loadPack(allowedPack(cfg.pack));
  if (sizeChanged) {
    await applyPetSize();
    await refreshMonitor();
    if (state === "idle") void settle(); // feet back on the ground
  }
});

// Mirror the tuning knobs to the Lanbeam agent so the iPad pet obeys the
// same settings panel. Silently a no-op when no agent is running.
async function pushSettingsToBridge() {
  if (!isMainPet) return;
  try {
    await invoke("pet_bridge_settings", {
      size: cfg.size,
      speed: cfg.speed,
      activity: cfg.activity,
      stunts: cfg.stunts,
    });
  } catch {
    // no agent — purely local pet
  }
}

void listen(LICENSE_EVENT, async () => {
  await refreshEntitlements();
  const pack = allowedPack(cfg.pack);
  if (pack !== currentPack) loadPack(pack);
});

async function init() {
  await refreshEntitlements();
  loadPack(allowedPack(cfg.pack));
  await applyPetSize();
  await refreshMonitor();
  await refreshPlatforms();
  standingOn = floorPlatform();
  const x = isMainPet
    ? Math.round(monX + (monW - winW) / 2)
    : Math.round(monX + (0.1 + Math.random() * 0.8) * (monW - winW));
  await appWindow.setPosition(new PhysicalPosition(x, monY + monH - winH));
  // A dev reload (or crash) while hidden for the iPad handoff would leave
  // the fresh session invisible — the window state outlives the page.
  await appWindow.show();
  setInterval(refreshPlatforms, 500);
  scheduleNext();
  void syncBridgeAtStartup();
}

init();
