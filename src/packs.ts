// Character packs: bundled originals under /packs (packs.json) and the
// user's own packs from "My character" / import, which live in the app data
// dir and are served through the `userpack` URI scheme. Bundled packs with a
// `pack` field belong to a paid pack and need a license (see license.rs).
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Instrument } from "./settings-store";

export type PackInfo = {
  id: string;
  name: string;
  names?: Partial<Record<string, string>>;
  emoji?: string;
  instrument?: Instrument;
  // Logical px the walk covers per 0.75 s at 100% size.
  stride?: number;
  // Display width (logical px at 100%) for states whose cell differs from idle.
  widths?: Partial<Record<string, number>>;
  user?: boolean;
  source?: string;
  // Paid pack this character belongs to (e.g. "band"); absent = free.
  pack?: string;
};

export type License = { packs: string[]; id: string | null };
export const LICENSE_EVENT = "license-changed";

export async function getLicense(): Promise<License> {
  try {
    return await invoke<License>("license_status");
  } catch {
    return { packs: [], id: null };
  }
}

export const hasBand = (lic: License) => lic.packs.includes("band");

export function isUnlocked(p: PackInfo, lic: License): boolean {
  return !p.pack || lic.packs.includes(p.pack);
}

export const isUserPack = (id: string) => id.startsWith("user-");

export function spriteUrl(pack: string, file: string): string {
  return isUserPack(pack)
    ? convertFileSrc(`${pack}/${file}`, "userpack")
    : `/packs/${pack}/${file}`;
}

export function jobUrl(path: string): string {
  return convertFileSrc(`_jobs/${path}`, "userpack");
}

async function fetchPacks(url: string): Promise<PackInfo[]> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as PackInfo[]) : [];
  } catch {
    return [];
  }
}

export async function listPacks(): Promise<PackInfo[]> {
  const bundled = await fetchPacks("/packs/packs.json");
  let user: PackInfo[] = [];
  try {
    user = (await invoke<PackInfo[]>("list_user_packs")).map((p) => ({ ...p, user: true }));
  } catch {
    user = [];
  }
  return [...bundled, ...user];
}

// Packs this computer may show, given its license.
export async function listUsablePacks(): Promise<PackInfo[]> {
  const [packs, lic] = await Promise.all([listPacks(), getLicense()]);
  return packs.filter((p) => isUnlocked(p, lic));
}

export function packLabel(p: PackInfo, lang: string): string {
  const name = p.names?.[lang] ?? p.name;
  return p.emoji ? `${p.emoji} ${name}` : name;
}

// Default walk stride (logical px per 0.75 s) for packs that don't say.
export function packStride(p: PackInfo | undefined): number {
  return p?.stride ?? 32;
}
