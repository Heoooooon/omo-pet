// UI language is independent of pet tuning and shared by all app windows.
export type Language = "en" | "ko";

const en = {
  settingsTitle: "Pet settings",
  settingsHeading: "🐾 Pet settings",
  close: "Close",
  language: "Language",
  character: "Character",
  size: "Size",
  speed: "Walking speed",
  activity: "Activity (how often your pet moves)",
  stunts: "Rocket & jet frequency",
  crossMonitors: "Move between monitors",
  ipadHandoff: "Hop over to iPad (Lanbeam)",
  reset: "Reset pet settings",
  friend: "Add friend",
  settings: "Settings",
  showOverlay: "Show platforms",
  hideOverlay: "Hide platforms",
  quit: "Quit",
  pet: "Desktop pet",
  overlayTitle: "Platform overlay",
  platform: "Platform",
  excluded: "Excluded",
  legend: "🟩 Walkable platform   🟥 Excluded (too narrow or high)   🟦 Floor",
} as const;

type MessageKey = keyof typeof en;

const ko: Record<MessageKey, string> = {
  settingsTitle: "펫 설정",
  settingsHeading: "🐾 펫 설정",
  close: "닫기",
  language: "언어",
  character: "캐릭터",
  size: "크기",
  speed: "걷는 속도",
  activity: "활동성 (돌아다니는 빈도)",
  stunts: "로켓·제트 묘기 빈도",
  crossMonitors: "모니터 사이 넘나들기",
  ipadHandoff: "iPad로 건너가기 (Lanbeam)",
  reset: "펫 설정 기본값으로 되돌리기",
  friend: "친구 추가",
  settings: "설정",
  showOverlay: "인식 표시",
  hideOverlay: "표시 끄기",
  quit: "종료",
  pet: "데스크톱 펫",
  overlayTitle: "인식 오버레이",
  platform: "발판",
  excluded: "제외",
  legend: "🟩 걸을 수 있는 발판   🟥 인식됐지만 제외(좁음/높음)   🟦 바닥",
};

const messages = { en, ko } as const;
const KEY = "omo-pet-language";
const CHANGE_EVENT = "language-changed";

export function isLanguage(value: string | null): value is Language {
  return value === "en" || value === "ko";
}

export function getLanguage(): Language {
  const saved = localStorage.getItem(KEY);
  if (isLanguage(saved)) return saved;
  return navigator.language.toLowerCase().split("-")[0] === "ko" ? "ko" : "en";
}

export function t(key: MessageKey): string {
  return messages[getLanguage()][key];
}

export function setLanguage(language: Language) {
  localStorage.setItem(KEY, language);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function isMessageKey(value: string | undefined): value is MessageKey {
  return value !== undefined && Object.hasOwn(en, value);
}

// Text lives in dedicated spans so translating a label never removes its input.
export function initI18n(onChange?: () => void) {
  const render = () => {
    document.documentElement.lang = getLanguage();
    for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
      const key = element.dataset.i18n;
      if (isMessageKey(key)) element.textContent = t(key);
    }
    for (const attribute of ["title", "aria-label", "alt"] as const) {
      for (const element of document.querySelectorAll<HTMLElement>(
        `[data-i18n-${attribute}]`,
      )) {
        const key = element.getAttribute(`data-i18n-${attribute}`);
        if (key !== null && isMessageKey(key)) element.setAttribute(attribute, t(key));
      }
    }
    onChange?.();
  };
  window.addEventListener(CHANGE_EVENT, render);
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) render();
  });
  render();
}
