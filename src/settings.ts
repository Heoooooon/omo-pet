// Settings panel: edits PetSettings and broadcasts changes live. Three tabs:
// pet tuning, band mode, and "My character" (create / import packs).
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getLanguage, initI18n, isLanguage, setLanguage, t, type MessageKey } from "./i18n";
import {
  DEFAULTS,
  loadSettings,
  saveSettings,
  type Instrument,
  type PetSettings,
} from "./settings-store";
import {
  getLicense,
  hasBand,
  isUnlocked,
  jobUrl,
  LICENSE_EVENT,
  listPacks,
  packLabel,
  type License,
  type PackInfo,
} from "./packs";
import { BAND_OPEN, INSTRUMENT_EMOJI, STAGE_ORDER } from "./band-shared";
import { createAnimated, createStill, type Built, type StepId, type ToolStatus } from "./creator";

const win = getCurrentWindow();
let s = loadSettings();
let packs: PackInfo[] = [];
let license: License = { packs: [], id: null };

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

// Sliders hold percentages; settings hold multipliers.
const SLIDERS = ["size", "speed", "activity", "stunts", "bandVolume"] as const;
const TOGGLES = ["crossMonitors", "ipadHandoff", "bandRandom"] as const;
const INSTRUMENTS: Instrument[] = ["vocal", "guitar", "bass", "drums", "keys"];
const instLabel = (i: Instrument) => `${INSTRUMENT_EMOJI[i]} ${t(`inst_${i}` as MessageKey)}`;

const language = $<HTMLSelectElement>("language");
language.addEventListener("change", () => {
  if (isLanguage(language.value)) setLanguage(language.value);
});

// ---------- tabs ----------

function showTab(name: string) {
  for (const tab of document.querySelectorAll<HTMLButtonElement>("#tabs button")) {
    tab.classList.toggle("active", tab.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll<HTMLElement>(".panel")) {
    panel.hidden = panel.id !== `panel-${name}`;
  }
  $("footer").hidden = name !== "pet";
  if (name === "custom" && !tools) void detectTools();
}

for (const tab of document.querySelectorAll<HTMLButtonElement>("#tabs button")) {
  tab.addEventListener("click", () => showTab(tab.dataset.tab!));
}
// The pet opens Settings on the band tab when a locked band is requested.
void listen<string>("settings-tab", (e) => showTab(e.payload));

// ---------- pet + band settings ----------

function render() {
  for (const key of SLIDERS) {
    $<HTMLInputElement>(key).value = String(Math.round(s[key] * 100));
    $<HTMLOutputElement>(`${key}-out`).value = `${Math.round(s[key] * 100)}%`;
  }
  for (const key of TOGGLES) $<HTMLInputElement>(key).checked = s[key];
  $<HTMLInputElement>("bandSound").checked = !s.bandMuted;
  for (const btn of $("packs").querySelectorAll<HTMLButtonElement>("button")) {
    const on = btn.dataset.pack === s.pack || s.companions.includes(btn.dataset.pack!);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  }
  for (const sel of $("roster").querySelectorAll("select")) {
    sel.value = s.bandRoster[sel.dataset.inst as Instrument];
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

$<HTMLInputElement>("bandSound").addEventListener("change", (e) => {
  s = { ...s, bandMuted: !(e.target as HTMLInputElement).checked };
  queueSave();
});

$("packs").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  const pack = btn?.dataset.pack;
  if (!pack) return;
  if (btn.classList.contains("locked")) return showTab("band");
  // Each character is shown or hidden on its own; one always stays out.
  if (pack === s.pack) {
    const [next, ...rest] = s.companions;
    if (!next) return;
    s = { ...s, pack: next, companions: rest };
  } else if (s.companions.includes(pack)) {
    s = { ...s, companions: s.companions.filter((id) => id !== pack) };
  } else {
    s = { ...s, companions: [...s.companions, pack] };
  }
  render();
  queueSave();
});

$("reset").addEventListener("click", () => {
  s = { ...DEFAULTS, companions: [...DEFAULTS.companions], bandRoster: { ...DEFAULTS.bandRoster } };
  render();
  queueSave();
});

$("band-now").addEventListener("click", () => void emit(BAND_OPEN));

let busy = false;
$("close").addEventListener("click", () => {
  // A running character build lives in this window: hide, don't close.
  if (busy) void win.hide();
  else void win.close();
});

$("drag").addEventListener("mousedown", (e) => {
  if ((e.target as HTMLElement).id === "close") return;
  void win.startDragging();
});

function renderPacks() {
  const lang = getLanguage();
  $("packs").replaceChildren(
    ...packs.map((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.pack = p.id;
      const locked = !isUnlocked(p, license);
      btn.classList.toggle("locked", locked);
      btn.textContent = locked ? `🔒 ${packLabel(p, lang)}` : packLabel(p, lang);
      if (locked) btn.title = t("lockedPack");
      return btn;
    }),
  );
  const rows: HTMLElement[] = [];
  for (const inst of STAGE_ORDER) {
    const label = document.createElement("span");
    label.textContent = instLabel(inst);
    const sel = document.createElement("select");
    sel.className = "full";
    sel.dataset.inst = inst;
    for (const p of packs.filter((p) => p.instrument === inst && isUnlocked(p, license))) {
      sel.add(new Option(packLabel(p, lang), p.id));
    }
    sel.addEventListener("change", () => {
      s = { ...s, bandRoster: { ...s.bandRoster, [inst]: sel.value } };
      queueSave();
    });
    rows.push(label, sel);
  }
  $("roster").replaceChildren(...rows);
  renderMyPacks();
  renderLicense();
  render();
}

async function refreshPacks() {
  [packs, license] = await Promise.all([listPacks(), getLicense()]);
  renderPacks();
}

// ---------- band pack license ----------

function renderLicense() {
  const owned = hasBand(license);
  $("store").hidden = owned;
  $("band-controls").hidden = !owned;
  $("license-entry").hidden = owned;
  $("license-remove").hidden = !owned;
  $("license-state").textContent = owned
    ? t("licenseActive").replace("{id}", license.id ?? "")
    : t("licenseNone");
  $<HTMLTextAreaElement>("license-key").placeholder = t("licenseKeyPlaceholder");
}

async function applyLicense(command: string, args: Record<string, string>) {
  try {
    license = await invoke<License>(command, args);
    $<HTMLTextAreaElement>("license-key").value = "";
    message("license-msg", t("licenseDone"));
  } catch (e) {
    message("license-msg", friendlyError(e), true);
  }
  await emit(LICENSE_EVENT);
  await refreshPacks();
}

$("license-file").addEventListener("click", async () => {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "omo-pet license", extensions: ["omopet-license", "txt"] }],
  });
  if (typeof path === "string") await applyLicense("license_import", { path });
});

$("license-apply").addEventListener("click", async () => {
  const text = $<HTMLTextAreaElement>("license-key").value.trim();
  if (text) await applyLicense("license_activate", { text });
});

$("license-remove").addEventListener("click", async () => {
  await invoke("license_remove").catch(() => undefined);
  message("license-msg", "");
  await emit(LICENSE_EVENT);
  await refreshPacks();
});

// ---------- My character ----------

let tools: ToolStatus | null = null;
let sourcePath: string | null = null;
let built: Built | null = null;
let steps: { id: StepId; status: string; detail?: string }[] = [];

const STEP_LABEL: Record<StepId, MessageKey> = {
  side: "stepSide",
  play: "stepPlay",
  chute: "stepChute",
  idle: "stepIdle",
  walk: "stepWalk",
  fall: "stepFall",
  playAnim: "stepPlayAnim",
  pack: "stepPack",
};
const STEP_ICON: Record<string, string> = { wait: "\u25cb", run: "\u23f3", done: "\u2705", fail: "\u274c" };

const canAnimate = () => tools !== null && tools.grok_login !== "missing" && tools.grok_login !== "unreadable";
const canStill = () => canAnimate() || (tools?.codex_installed && tools.codex_logged_in) === true;

function renderInstruments() {
  const sel = $<HTMLSelectElement>("cinst");
  const value = sel.value || "guitar";
  sel.replaceChildren(...INSTRUMENTS.map((i) => new Option(instLabel(i), i)));
  sel.value = value;
}

function renderTools() {
  const items: string[] = [];
  if (tools) {
    if (!tools.grok_installed && tools.grok_login === "missing") items.push(`\u2716 ${t("grokNoCli")}`);
    else if (tools.grok_login === "ok") items.push(`\u2714 ${t("grokOk")}`);
    else if (tools.grok_login === "expired") items.push(`\u2714 ${t("grokExpired")}`);
    else items.push(`\u2716 ${t("grokMissing")}`);
    if (!tools.codex_installed) items.push(`\u2013 ${t("codexMissing")}`);
    else items.push(`${tools.codex_logged_in ? "\u2714" : "\u2716"} ${t(tools.codex_logged_in ? "codexOk" : "codexLoggedOut")}`);
    if (!canStill()) items.push(`\u2716 ${t("noTools")}`);
  } else {
    items.push("\u2026");
  }
  $("tools").replaceChildren(
    ...items.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
  const create = $<HTMLButtonElement>("create");
  create.textContent = t(canAnimate() || !canStill() ? "create" : "createStill");
  create.disabled = busy || !canStill();
  $("still-note").hidden = !tools || canAnimate() || !canStill();
}

async function detectTools() {
  tools = null;
  renderTools();
  tools = await invoke<ToolStatus>("creator_detect");
  renderTools();
}
$("recheck").addEventListener("click", () => void detectTools());

function message(id: string, text: string, error = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle("err", error);
  el.hidden = !text;
}

function friendlyError(e: unknown): string {
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  if (text.startsWith("grok-auth") || text === "grok-missing" || text === "grok-expired") return t("errGrokAuth");
  if (text.startsWith("codex-auth")) return t("errCodexAuth");
  if (text === "slot-limit") return t("errSlotLimit");
  if (text === "license-invalid") return t("errLicense");
  return text;
}

$("pick").addEventListener("click", async () => {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (typeof path !== "string") return;
  try {
    sourcePath = await invoke<string>("creator_new_job", { source: path });
  } catch (e) {
    message("create-msg", friendlyError(e), true);
    return;
  }
  const thumb = $<HTMLImageElement>("pick-thumb");
  thumb.src = jobUrl(sourcePath);
  thumb.hidden = false;
  const name = $<HTMLInputElement>("cname");
  if (!name.value) name.value = path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").slice(0, 20);
  built = null;
  $("result").hidden = true;
  message("create-msg", "");
});

function renderSteps() {
  $("steps").replaceChildren(
    ...steps.map((st) => {
      const li = document.createElement("li");
      li.dataset.status = st.status;
      li.textContent = `${STEP_ICON[st.status]} ${t(STEP_LABEL[st.id])}${st.detail ? ` \u2014 ${st.detail}` : ""}`;
      return li;
    }),
  );
}

function setBusy(on: boolean) {
  busy = on;
  for (const id of ["pick", "cname", "cinst", "create", "recheck"]) {
    ($(id) as HTMLButtonElement).disabled = on;
  }
  if (!on) renderTools();
}

$("create").addEventListener("click", async () => {
  if (!sourcePath) return message("create-msg", t("pickFirst"), true);
  if (!$<HTMLInputElement>("cname").value.trim()) return message("create-msg", t("nameFirst"), true);
  // Don't spend minutes of drawing on a character the free slot can't hold.
  if (!hasBand(license) && packs.some((p) => p.user)) return message("create-msg", t("errSlotLimit"), true);
  const inst = $<HTMLSelectElement>("cinst").value as Instrument;
  const animated = canAnimate();
  const ids: StepId[] = animated
    ? ["side", "play", "chute", "idle", "walk", "fall", "playAnim", "pack"]
    : ["side", "play", "pack"];
  steps = ids.map((id) => ({ id, status: "wait" }));
  renderSteps();
  message("create-msg", "");
  $("progress").hidden = false;
  $("result").hidden = true;
  setBusy(true);
  $<HTMLButtonElement>("create").textContent = t("creating");
  $("progress").scrollIntoView({ block: "start", behavior: "smooth" });
  const job = sourcePath.split("/")[0];
  const onStep = (id: StepId, status: string, detail?: string) => {
    const st = steps.find((x) => x.id === id);
    if (st) Object.assign(st, { status, detail: status === "run" && detail ? detail : status === "fail" ? friendlyError(detail) : undefined });
    renderSteps();
  };
  try {
    built = animated
      ? await createAnimated(job, sourcePath, inst, onStep)
      : await createStill(job, sourcePath, inst, false, onStep);
    showResult();
  } catch (e) {
    message("create-msg", t("stopped").replace("{reason}", friendlyError(e)), true);
    $<HTMLButtonElement>("create").textContent = t("retry");
  } finally {
    setBusy(false);
    if (!$("create-msg").hidden) $<HTMLButtonElement>("create").textContent = t("retry");
  }
});

function showResult() {
  if (!built) return;
  const figs = (["idle", "walk", "fall", "play"] as const)
    .filter((k) => built!.previews[k])
    .map((k) => {
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.src = built!.previews[k]!;
      const cap = document.createElement("figcaption");
      cap.textContent = k;
      fig.append(img, cap);
      return fig;
    });
  $("previews").replaceChildren(...figs);
  $("result").hidden = false;
  $("progress").hidden = true;
  $("result").scrollIntoView({ block: "start", behavior: "smooth" });
}

$("bg-toggle").addEventListener("click", () => $("previews").classList.toggle("dark"));

$("discard").addEventListener("click", async () => {
  if (!built) return;
  await invoke("creator_discard", { job: built.job }).catch(() => undefined);
  built = null;
  sourcePath = null;
  $("result").hidden = true;
  $<HTMLImageElement>("pick-thumb").hidden = true;
});

$("save").addEventListener("click", async () => {
  if (!built) return;
  const inst = $<HTMLSelectElement>("cinst").value as Instrument;
  try {
    const saved = await invoke<PackInfo>("creator_save", {
      job: built.job,
      manifest: { name: $<HTMLInputElement>("cname").value.trim(), instrument: inst, stride: built.stride },
    });
    built = null;
    sourcePath = null;
    $("result").hidden = true;
    $<HTMLImageElement>("pick-thumb").hidden = true;
    $<HTMLInputElement>("cname").value = "";
    message("create-msg", `${t("saved")} (${saved.name})`);
    await refreshPacks();
  } catch (e) {
    message("create-msg", friendlyError(e), true);
  }
});

async function importFrom(directory: boolean) {
  const path = await open({
    multiple: false,
    directory,
    filters: directory ? undefined : [{ name: "Zip", extensions: ["zip"] }],
  });
  if (typeof path !== "string") return;
  try {
    const pack = await invoke<PackInfo>("import_pack", { path });
    message("import-msg", t("imported").replace("{name}", pack.name));
    await refreshPacks();
  } catch (e) {
    message("import-msg", friendlyError(e), true);
  }
}
$("import-folder").addEventListener("click", () => void importFrom(true));
$("import-zip").addEventListener("click", () => void importFrom(false));

function renderMyPacks() {
  const mine = packs.filter((p) => p.user);
  $("slot-note").hidden = hasBand(license);
  $("slot-note").textContent = t("slotNote").replace("{used}", String(mine.length));
  if (!mine.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = t("noPacks");
    $("mypacks").replaceChildren(li);
    return;
  }
  $("mypacks").replaceChildren(
    ...mine.map((p) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${p.name}${p.instrument ? ` \u00b7 ${instLabel(p.instrument)}` : ""}`;
      const use = document.createElement("button");
      use.className = "btn";
      use.textContent = t("usePet");
      use.addEventListener("click", () => {
        s = { ...s, pack: p.id, companions: s.companions.filter((id) => id !== p.id) };
        render();
        queueSave();
      });
      const del = document.createElement("button");
      del.className = "btn";
      del.textContent = t("remove");
      del.addEventListener("click", async () => {
        await invoke("delete_user_pack", { id: p.id });
        s = { ...s, companions: s.companions.filter((id) => id !== p.id) };
        if (s.pack === p.id) {
          const [next = DEFAULTS.pack, ...rest] = s.companions;
          s = { ...s, pack: next, companions: rest };
        }
        for (const inst of INSTRUMENTS) {
          if (s.bandRoster[inst] === p.id) s = { ...s, bandRoster: { ...s.bandRoster, [inst]: DEFAULTS.bandRoster[inst] } };
        }
        queueSave();
        await refreshPacks();
      });
      li.append(name, use, del);
      return li;
    }),
  );
}

initI18n(() => {
  language.value = getLanguage();
  void win.setTitle(t("settingsTitle"));
  renderPacks();
  renderInstruments();
  renderTools();
  renderSteps();
});
void refreshPacks();
const initialTab = new URLSearchParams(location.search).get("tab");
if (initialTab) showTab(initialTab);
