// Web overlay: the desktop pet walking over a web page instead of the screen.
// One fixed layer on top of the page; the layer and the pet box never take
// the pointer, so the page underneath keeps working. Only presses on the
// character's drawn pixels are caught (capture phase, before the page sees
// them): click for hearts, drag to carry, right-click / long-press for the menu.
//
// Load it same-origin (CSP script-src/style-src 'self' is enough):
//   <link rel="stylesheet" href="/omopet/overlay.css">
//   <script src="/omopet/overlay.js" defer
//           data-pack="omo" data-avoid='[data-ui="composer"]'></script>
import { apngAlphaMask, hitsMask, spritePoint, type AlphaMask } from "../hit-mask";
import { jetSpriteFor } from "../jet-sprite";
import { clear, flightCeiling, restingY, walkRange, type Body, type Rect, type World } from "./geometry";

type PackManifest = { id: string; name: string; stride: number; states: string[] };
type State = "idle" | "walk" | "drag" | "react" | "fall" | "edge" | "rocket" | "jet";

const script = document.currentScript as HTMLScriptElement | null;
const opts = script?.dataset ?? {};
const base = new URL(".", script?.src ?? location.href).href;
const AVOID = opts.avoid ?? '[data-ui="composer"], [data-omopet-avoid]';
const PLATFORMS = opts.platforms ?? "[data-omopet-platform]";
const PACK_KEY = "omopet-overlay-pack";
const BOX_W = 240; // the desktop pet window, so every per-state CSS width fits
const BOX_H = 320;
const HIT_MARGIN = 6;
const GRAVITY = 1300; // CSS px/s², freefall before the chute opens
const DRIFT = 130; // CSS px/s under the parachute
const CHUTE_DELAY = 0.55;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

const root = document.createElement("div");
root.className = "omopet";
root.setAttribute("aria-hidden", "true");
const box = document.createElement("div");
box.className = "omopet-box";
const pet = document.createElement("img");
pet.className = "omopet-pet";
pet.alt = "";
pet.draggable = false;
const effects = document.createElement("div");
effects.className = "omopet-effects";
box.append(pet, effects);
const menu = document.createElement("div");
menu.className = "omopet-menu";
menu.hidden = true;
root.append(box, menu);

let packs: PackManifest[] = [];
let pack: PackManifest | null = null;
let state: State = "idle";
let version = 0;
let size = 1;
let x = 0; // box left
let feet = 0; // feet line = box bottom
let flip: -1 | 1 = 1;
let frame: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let world: World = { width: innerWidth, height: innerHeight, platforms: [], avoid: [] };

const boxW = () => BOX_W * size;
const boxH = () => BOX_H * size;
// Widest standing sprite (OmO's parachute is 205 of the 240 px box) and the
// tallest drawn frame; geometry keeps this body clear of the composer.
const body = (): Body => ({ half: 105 * size, height: 280 * size });
const centerX = () => x + boxW() / 2;
const spriteUrl = (key: string) => `${base}packs/${pack?.id}/${key}.apng`;
const has = (key: string) => !!pack?.states.includes(key);

// ---------- page geometry ----------

function rectOf(el: Element): Rect | null {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= innerHeight) return null;
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function readWorld() {
  const avoid: Rect[] = [];
  for (const el of document.querySelectorAll(AVOID)) {
    const r = rectOf(el);
    if (r) avoid.push(r);
  }
  const platforms = [];
  for (const el of document.querySelectorAll(PLATFORMS)) {
    const r = rectOf(el);
    if (r && r.top > boxH() * 0.6) platforms.push({ x1: r.left, x2: r.right, y: r.top });
  }
  world = { width: document.documentElement.clientWidth, height: innerHeight, platforms, avoid };
}

// Layout changed under the pet (room opened, composer grew, window resized):
// keep her on screen and off the composer.
function relayout() {
  readWorld();
  applySize();
  const maxX = world.width - boxW();
  if (x > maxX || x < 0) place(Math.max(0, Math.min(maxX, x)), feet);
  if (state === "drag" || state === "fall" || state === "rocket" || state === "jet") return;
  const rest = restingY(world, centerX(), Math.min(feet, world.height), body());
  if (rest !== feet || !clear(world, centerX(), feet, body())) {
    if (rest < feet) place(x, rest); // lifted onto the composer: no fall through it
    else return void fall();
  }
}

let relayoutQueued = false;
function queueRelayout() {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => {
    relayoutQueued = false;
    relayout();
  });
}

// ---------- drawing ----------

function place(nx: number, nfeet: number) {
  x = nx;
  feet = nfeet;
  box.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(feet - boxH())}px, 0)`;
}

function applySize() {
  const wanted = Number(opts.size) || (innerWidth < 600 ? 0.55 : 0.75);
  if (wanted === size && box.style.width) return;
  size = wanted;
  box.style.width = `${boxW()}px`;
  box.style.height = `${boxH()}px`;
  (pet.style as CSSStyleDeclaration & { zoom: string }).zoom = String(size);
}

function setFlip(dir: -1 | 1) {
  flip = dir;
  pet.style.setProperty("--flip", String(dir));
}

function show(key: string, restart = false) {
  const url = spriteUrl(has(key) ? key : "idle");
  if (restart) pet.src = `${url}?t=${Date.now()}`;
  else if (pet.src.split("?")[0] !== url) pet.src = url;
}

function setState(next: State, sprite: string = next) {
  stopMotion();
  state = next;
  version += 1;
  box.dataset.state = next;
  delete box.dataset.fallPhase;
  delete box.dataset.jetPhase;
  show(sprite, next === "fall" || next === "edge");
}

function stopMotion() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

// requestAnimationFrame loop with a clamped dt; returning false ends it.
function animate(step: (dt: number) => boolean | void) {
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (step(dt) === false) {
      frame = null;
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
}

const ease = (p: number) => p * p * (3 - 2 * p);
const wait = (ms: number, then: () => void) => {
  timer = setTimeout(then, ms);
};

// ---------- behaviours ----------

function idle() {
  setState("idle");
  if (reduceMotion.matches) return; // stays put; clicks still get hearts
  wait(2000 + Math.random() * 3000, () => {
    const roll = Math.random();
    if (roll < 0.12 && has("rocket")) rocket();
    else if (roll < 0.24 && has("jet")) jet();
    else if (roll < 0.85) walk();
    else idle();
  });
}

function walk() {
  readWorld();
  const range = walkRange(world, centerX(), feet, body());
  if (range.max - range.min < 8) return range.minEnd === "blocked" || range.maxEnd === "blocked" ? rocket() : idle();
  let target = range.min + Math.random() * (range.max - range.min);
  if (Math.random() < 0.35) target = Math.random() < 0.5 ? range.min : range.max;
  const dir: -1 | 1 = target > centerX() ? 1 : -1;
  const speed = ((pack?.stride ?? 43) / 0.75) * size;
  const accel = speed / 0.24;
  setFlip(dir);
  setState("walk");
  let v = 0;
  animate((dt) => {
    const left = Math.abs(target - centerX());
    const desired = Math.min(speed, Math.sqrt(2 * accel * left));
    const prev = v;
    v += Math.max(-accel * dt, Math.min(accel * dt, desired - v));
    const move = ((prev + v) / 2) * dt;
    if (move >= left) {
      place(target - boxW() / 2, feet);
      const end = Math.abs(target - range.min) < 2 ? range.minEnd : Math.abs(target - range.max) < 2 ? range.maxEnd : null;
      if (end === "wall") edge(dir, false);
      else if (end === "drop") edge(dir, true);
      else idle();
      return false;
    }
    place(x + move * dir, feet);
  });
}

// Climb up and sit on the corner; off a ledge, hop down afterwards.
function edge(dir: -1 | 1, hopAfter: boolean) {
  setFlip(dir);
  setState("edge");
  wait(4000 + Math.random() * 4000, () => (hopAfter ? hopOff(dir) : idle()));
}

function hopOff(dir: -1 | 1) {
  setFlip(dir);
  setState("walk");
  const startX = x;
  const startFeet = feet;
  const distance = dir * 150 * size;
  let t = 0;
  animate((dt) => {
    t += dt;
    const p = Math.min(1, t / 0.35);
    place(startX + distance * ease(p), startFeet - Math.sin(Math.PI * p) ** 2 * 12 * size);
    if (p === 1) {
      fall();
      return false;
    }
  });
}

function fall() {
  const phased = has("fall-open") && has("fall-glide");
  setState("fall", phased ? "fall-open" : "fall");
  if (phased) box.dataset.fallPhase = "open";
  const mine = version;
  let vy = 0;
  let t = 0;
  let gliding = false;
  animate((dt) => {
    t += dt;
    if (t < CHUTE_DELAY) vy += GRAVITY * dt;
    else {
      vy = DRIFT + (vy - DRIFT) * Math.exp(-14 * dt);
      if (phased && !gliding) {
        gliding = true;
        show("fall-glide");
        box.dataset.fallPhase = "glide";
      }
    }
    // Re-target every frame: the page may scroll or a room may open mid-fall.
    const rest = restingY(world, centerX(), feet, body());
    const next = Math.min(rest, feet + vy * dt);
    place(x, next);
    if (next < rest) return;
    if (phased && has("fall-land")) {
      show("fall-land", true);
      box.dataset.fallPhase = "land";
      wait(450, () => mine === version && idle());
    } else idle();
    return false;
  });
}

function rocket() {
  readWorld();
  const high = world.platforms.filter((p) => p.y < feet - boxH() * 0.6);
  const target = high.length && Math.random() < 0.7 ? high[Math.floor(Math.random() * high.length)] : null;
  const startX = x;
  const startFeet = feet;
  const targetX = target
    ? Math.max(target.x1 - boxW() / 2, Math.min(target.x2 - boxW() / 2, (target.x1 + target.x2) / 2 - boxW() / 2))
    : startX;
  const apex = target ? target.y - 40 * size : boxH() + 8;
  if (targetX !== startX) setFlip(targetX > startX ? 1 : -1);
  setState("rocket");
  box.classList.add("ignite");
  wait(650, () => {
    box.classList.remove("ignite");
    const duration = Math.max(1.2, ((startFeet - apex) / 900) * 1.5);
    let t = 0;
    animate((dt) => {
      t += dt;
      const p = Math.min(1, t / duration);
      place(startX + (targetX - startX) * ease(p), startFeet + (apex - startFeet) * ease(p));
      if (p === 1) {
        fall();
        return false;
      }
    });
  });
}

function jet() {
  readWorld();
  const lo = 0;
  const hi = world.width - boxW();
  let targetX = lo + Math.random() * (hi - lo);
  if (Math.abs(targetX - x) < world.width * 0.35) targetX = x < (lo + hi) / 2 ? hi : lo;
  const startX = x;
  const startFeet = feet;
  // Cruise above everything the flight passes, never above the viewport top.
  const ceiling = flightCeiling(world, centerX(), targetX + boxW() / 2, body()) - 24 * size;
  const cruise = Math.max(boxH() * 0.75, Math.min(ceiling, startFeet - (60 + Math.random() * 160) * size));
  const dir: -1 | 1 = targetX > startX ? 1 : -1;
  setFlip(dir);
  const climbShare = 0.3;
  const climbSprite = jetSpriteFor((targetX - startX) * ease(climbShare), cruise - startFeet, has);
  setState("jet", climbSprite);
  if (climbSprite === "jet-climb") box.dataset.jetPhase = "climb";
  let climbing = climbSprite === "jet-climb";
  const duration = Math.max(1.1, (Math.abs(targetX - startX) / 700) * 1.5);
  let t = 0;
  animate((dt) => {
    t += dt;
    const p = Math.min(1, t / duration);
    if (climbing && p >= climbShare) {
      climbing = false;
      delete box.dataset.jetPhase;
      show("jet");
    }
    const bob = Math.sin(t * 5.5) * 7 * size * Math.sin(Math.PI * p) ** 2;
    place(startX + (targetX - startX) * ease(p), startFeet + (cruise - startFeet) * ease(Math.min(1, p / climbShare)) + bob);
    if (p === 1) {
      fall();
      return false;
    }
  });
}

function react() {
  setState("react");
  for (let i = 0; i < 3; i++) {
    const heart = document.createElement("span");
    heart.className = "omopet-heart";
    heart.textContent = ["💖", "✨", "🌸"][i];
    heart.style.left = `${30 + Math.random() * 40}%`;
    heart.style.bottom = `${45 + Math.random() * 25}%`;
    heart.style.animationDelay = `${Math.random() * 0.25}s`;
    effects.append(heart);
    setTimeout(() => heart.remove(), 1600);
  }
  wait(600, () => {
    const rest = restingY(world, centerX(), feet, body());
    if (rest > feet + 2) fall();
    else idle();
  });
}

// ---------- pointer: only the drawn pixels count ----------

const masks = new Map<string, Promise<AlphaMask | null>>();
function maskFor(src: string) {
  const key = src.split("?")[0];
  let m = masks.get(key);
  if (!m) {
    m = fetch(key)
      .then((r) => r.arrayBuffer())
      .then((b) => apngAlphaMask(new Uint8Array(b)))
      .catch(() => null);
    masks.set(key, m);
  }
  return m;
}
// Hit tests run inside synchronous event handlers, so keep the resolved masks.
const ready = new Map<string, AlphaMask | null>();
function readyMask(src: string): AlphaMask | null | undefined {
  const key = src.split("?")[0];
  if (!ready.has(key)) void maskFor(key).then((m) => ready.set(key, m));
  return ready.get(key);
}

pet.addEventListener("load", () => void readyMask(pet.src));

function onPet(cx: number, cy: number): boolean {
  if (root.hidden || !pet.src) return false;
  const rect = pet.getBoundingClientRect();
  if (cx < rect.left - HIT_MARGIN || cx > rect.right + HIT_MARGIN || cy < rect.top - HIT_MARGIN || cy > rect.bottom + HIT_MARGIN) return false;
  const mask = readyMask(pet.currentSrc || pet.src);
  if (!mask) return false; // not decoded yet: let the page have the click
  const p = spritePoint(cx, cy, rect, mask, flip === -1);
  return hitsMask(mask, p.x, p.y, HIT_MARGIN * p.perCss);
}

let press: { id: number; dx: number; dy: number; sx: number; sy: number; moved: boolean; long: ReturnType<typeof setTimeout> | null } | null = null;
let swallowClick = false;

function stopPage(e: Event) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

addEventListener(
  "pointerdown",
  (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node)) menu.hidden = true;
    if (e.button !== 0 || !onPet(e.clientX, e.clientY)) return;
    stopPage(e);
    swallowClick = true;
    press = {
      id: e.pointerId,
      dx: e.clientX - x,
      dy: e.clientY - feet,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      long: e.pointerType === "mouse" ? null : setTimeout(() => openMenu(e.clientX, e.clientY), 550),
    };
  },
  true,
);

addEventListener(
  "pointermove",
  (e) => {
    if (press && e.pointerId === press.id) {
      stopPage(e);
      if (!press.moved && Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > 5) {
        press.moved = true;
        if (press.long) clearTimeout(press.long);
        setState("drag", "idle");
      }
      if (press.moved) place(e.clientX - press.dx, e.clientY - press.dy);
      return;
    }
    if (e.pointerType === "mouse") pet.classList.toggle("omopet-hot", onPet(e.clientX, e.clientY));
  },
  true,
);

function release(e: PointerEvent) {
  if (!press || e.pointerId !== press.id) return;
  stopPage(e);
  const was = press;
  press = null;
  if (was.long) clearTimeout(was.long);
  if (!menu.hidden) return;
  if (was.moved) {
    readWorld();
    const maxX = world.width - boxW();
    place(Math.max(0, Math.min(maxX, x)), Math.max(boxH() * 0.75, Math.min(world.height, feet)));
    fall();
  } else react();
}
addEventListener("pointerup", release, true);
addEventListener("pointercancel", release, true);

addEventListener(
  "click",
  (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    stopPage(e);
  },
  true,
);
// A pet press must not start a page scroll or text selection on touch.
addEventListener(
  "touchstart",
  (e) => {
    const t = e.touches[0];
    if (t && onPet(t.clientX, t.clientY)) e.preventDefault();
  },
  { capture: true, passive: false },
);
addEventListener(
  "contextmenu",
  (e) => {
    if (!onPet(e.clientX, e.clientY) && !press) return;
    stopPage(e);
    openMenu(e.clientX, e.clientY);
  },
  true,
);

// ---------- menu ----------

function openMenu(cx: number, cy: number) {
  if (press?.long) clearTimeout(press.long);
  press = null;
  menu.replaceChildren();
  for (const p of packs) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.name;
    b.setAttribute("aria-pressed", String(p.id === pack?.id));
    b.addEventListener("click", () => {
      menu.hidden = true;
      localStorage.setItem(PACK_KEY, p.id);
      usePack(p.id);
    });
    menu.append(b);
  }
  const hide = document.createElement("button");
  hide.type = "button";
  hide.textContent = "새로고침 전까지 숨기기";
  hide.addEventListener("click", () => {
    menu.hidden = true;
    setHidden(true);
  });
  menu.append(hide);
  menu.hidden = false;
  const w = 132;
  menu.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, cx - w / 2))}px`;
  menu.style.top = `${Math.max(4, cy - 12 - 34 * menu.children.length)}px`;
}

function setHidden(hidden: boolean) {
  // Hidden until the next page load only: there is no other way to call her back.
  root.hidden = hidden;
  if (hidden) stopMotion();
  else idle();
}

// ---------- packs ----------

function usePack(id: string) {
  pack = packs.find((p) => p.id === id) ?? packs[0];
  box.dataset.pack = pack.id;
  for (const c of [...box.classList]) if (c.startsWith("has-")) box.classList.remove(c);
  for (const s of pack.states) box.classList.add(`has-${s}`);
  // Warm the cache (about 3 MB a pack) once the page has settled, so the first
  // rocket or fall does not flash an empty frame.
  const warming = pack;
  setTimeout(() => {
    if (pack === warming) for (const s of warming.states) new Image().src = spriteUrl(s);
  }, 3000);
  if (state === "drag") show("idle");
  else idle();
}

async function start() {
  packs = await (await fetch(`${base}packs/packs.json`)).json();
  if (!packs.length) throw new Error("omopet: no packs in packs.json");
  document.body.append(root);
  applySize();
  readWorld();
  const saved = localStorage.getItem(PACK_KEY) ?? opts.pack ?? "omo";
  pack = packs.find((p) => p.id === saved) ?? packs[0];
  place(world.width * (0.2 + Math.random() * 0.3), 0);
  place(Math.min(x, world.width - boxW()), restingY(world, centerX(), 0, body()));
  usePack(pack.id);

  addEventListener("resize", queueRelayout);
  addEventListener("scroll", queueRelayout, true);
  new MutationObserver(queueRelayout).observe(document.body, { childList: true, subtree: true });
  new ResizeObserver(queueRelayout).observe(document.documentElement);
}

// Small handle for the page and for QA: window.omopet.do("jet") etc.
Object.assign(window, {
  omopet: {
    get state() {
      return state;
    },
    get pack() {
      return pack?.id;
    },
    rect: () => pet.getBoundingClientRect(),
    hits: onPet,
    avoid: () => world.avoid,
    do: (what: "walk" | "rocket" | "jet" | "fall" | "idle") => ({ walk, rocket, jet, fall, idle })[what](),
    usePack,
    hide: () => setHidden(true),
    show: () => setHidden(false),
  },
});

if (document.readyState === "loading") addEventListener("DOMContentLoaded", () => void start());
else void start();
