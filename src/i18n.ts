// UI language is independent of pet tuning and shared by all app windows.
export type Language = "en" | "ko";

const en = {
  settingsTitle: "Pet settings",
  settingsHeading: "🐾 Pet settings",
  close: "Close",
  language: "Language",
  character: "Characters (click to show or hide)",
  credits: "OmO and Jabdori © Sisyphus Labs (OmO Native), used with permission. Omo (kitten) © CMORE.",
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
  band: "Open band",
  tabPet: "Pet",
  tabBand: "Band",
  tabCustom: "My character",
  bandNow: "🎵 Open the band now",
  bandMembers: "Members",
  inst_vocal: "Vocals",
  inst_guitar: "Guitar",
  inst_bass: "Bass",
  inst_drums: "Drums",
  inst_keys: "Keyboard",
  bandSound: "Band music sound",
  bandVolume: "Band volume",
  bandRandom: "Sometimes gather on their own",
  bandHint: "Also in the tray menu and the pet's right-click menu. Sound starts off; turn it on from the button above the stage.",
  soundOn: "Sound on",
  soundOff: "Sound off",
  soundTap: "Click for sound",
  bandStop: "Stop",
  customTitle: "Make my character",
  rightsNotice: "Use only a picture you drew yourself or have the rights to. Characters from other works are not allowed.",
  privacyNote: "The picture is sent only to your own Grok (or Codex) account to be drawn. The finished character is saved on this computer only; the app uploads nothing else.",
  toolsTitle: "Drawing tools on this computer",
  grokOk: "Grok: signed in (stills + animation)",
  grokExpired: "Grok: sign-in expired, renewed automatically when you start",
  grokMissing: "Grok: not signed in. Run grok login in a terminal (animation needs a SuperGrok plan).",
  grokNoCli: "Grok CLI not installed (x.ai/cli). Needed for animation.",
  codexOk: "Codex: installed (stills only)",
  codexLoggedOut: "Codex: installed but not signed in (codex login)",
  codexMissing: "Codex CLI not installed (optional, stills only)",
  noTools: "No drawing tool is ready, so a character can't be made yet.",
  recheck: "Check again",
  pickImage: "Choose picture",
  charName: "Name",
  charInstrument: "Band instrument",
  create: "Start (about 5-10 min)",
  createStill: "Make a still character (no animation)",
  stillOnlyNote: "Without Grok the character is a still picture; walking uses a simple bounce.",
  stepSide: "Side pose",
  stepPlay: "Instrument pose",
  stepChute: "Parachute pose",
  stepIdle: "Idle animation",
  stepWalk: "Walk animation",
  stepFall: "Parachute animation",
  stepPlayAnim: "Instrument animation",
  stepPack: "Building sprites",
  working: "Closing this window only hides it; the work continues.",
  previewTitle: "Preview",
  save: "Save this character",
  discard: "Discard",
  retry: "Try again",
  saved: "Saved! Pick it under Pet › Character or as a band member.",
  importTitle: "Import a pack",
  importFolder: "From folder",
  importZip: "From zip",
  importHint: "A folder or zip with idle.apng (required), walk/fall/play.apng and pack.json.",
  imported: "Imported “{name}”.",
  myPacks: "My packs",
  noPacks: "None yet.",
  remove: "Delete",
  usePet: "Use as pet",
  stopped: "Stopped: {reason}",
  errGrokAuth: "Grok sign-in was rejected. Run grok login in a terminal, then try again.",
  errCodexAuth: "Codex sign-in expired. Run codex login in a terminal, then try again.",
  pickFirst: "Choose a picture first.",
  nameFirst: "Give your character a name.",
  creating: "Making your character…",
  bgToggle: "◐ Background",
  storeTitle: "🎸 Band pack (paid)",
  storeLead: "OmO, Jabdori and the Omo kitten are free. The band pack is a one-time purchase that adds Omo's band.",
  storeUnlocks: "What buying unlocks",
  storeItemFriends: "Four friends: Dalli (guitar), Bara (bass), Dochi (drums), Rupa (keys), as pets and band members",
  storeItemBand: "Band mode: the five gather on the taskbar line and play a short original song",
  storeItemSlots: "Unlimited My character slots (free: 1)",
  storeFree: "Free without buying",
  storeFreeOmo: "OmO, Jabdori and the Omo kitten with every move: windows, rocket, jet, parachute, multi-monitor, friends",
  storeFreeSlot: "One My character slot",
  storeWhere: "Buy “omo-pet Band Pack” on itch.io to get a license file and key. It is checked on this computer, with no account and no internet.",
  licenseTitle: "License",
  licenseNone: "No license on this computer.",
  licenseActive: "✅ Band pack unlocked ({id}). Keep your license file to restore it on another computer.",
  licenseImport: "Import license file",
  licenseKeyPlaceholder: "…or paste your license key (OMOPET1-…)",
  licenseApply: "Unlock with key",
  licenseRemove: "Remove license from this computer",
  licenseDone: "Unlocked! The band and the four friends are ready.",
  lockedPack: "Part of the band pack",
  errLicense: "This is not a valid omo-pet license. Check that the whole key (or the license file) was used.",
  errSlotLimit: "The free version keeps one My character. Delete it or unlock the band pack (Band tab) for unlimited slots.",
  slotNote: "Free version: {used}/1 My character slot used. The band pack removes the limit.",
} as const;

export type MessageKey = keyof typeof en;

const ko: Record<MessageKey, string> = {
  settingsTitle: "펫 설정",
  settingsHeading: "🐾 펫 설정",
  close: "닫기",
  language: "언어",
  character: "캐릭터 (눌러서 보이기·숨기기)",
  credits: "OmO·잡도리 © Sisyphus Labs (OmO Native), 허락 받아 사용. 오모(고양이) © CMORE.",
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
  band: "밴드 열기",
  tabPet: "펫",
  tabBand: "밴드",
  tabCustom: "내 캐릭터",
  bandNow: "🎵 지금 밴드 열기",
  bandMembers: "멤버",
  inst_vocal: "보컬",
  inst_guitar: "기타",
  inst_bass: "베이스",
  inst_drums: "드럼",
  inst_keys: "키보드",
  bandSound: "밴드 음악 소리",
  bandVolume: "밴드 음량",
  bandRandom: "가끔 저절로 밴드 열기",
  bandHint: "트레이 메뉴와 펫 우클릭 메뉴에서도 열 수 있어요. 소리는 꺼진 채 시작하고, 무대 위 버튼으로 켤 수 있어요.",
  soundOn: "소리 켜기",
  soundOff: "소리 끄기",
  soundTap: "눌러서 소리 켜기",
  bandStop: "그만",
  customTitle: "내 캐릭터 만들기",
  rightsNotice: "직접 그렸거나 사용 권리가 있는 그림만 쓰세요. 다른 작품의 캐릭터는 안 됩니다.",
  privacyNote: "그림은 그리기 위해 내 Grok(또는 Codex) 계정으로만 보내지고, 완성된 캐릭터는 이 컴퓨터에만 저장돼요. 앱이 따로 올리는 것은 없어요.",
  toolsTitle: "이 컴퓨터의 그리기 도구",
  grokOk: "Grok: 로그인됨 (그림 + 움직임)",
  grokExpired: "Grok: 로그인 만료됨, 시작할 때 자동으로 갱신해요",
  grokMissing: "Grok: 로그인 안 됨. 터미널에서 grok login을 실행하세요 (움직임은 SuperGrok 구독 필요).",
  grokNoCli: "Grok CLI 없음 (x.ai/cli에서 설치). 움직이는 캐릭터에 필요해요.",
  codexOk: "Codex: 설치됨 (그림만)",
  codexLoggedOut: "Codex: 설치됐지만 로그인 안 됨 (codex login)",
  codexMissing: "Codex CLI 없음 (선택 사항, 그림만)",
  noTools: "쓸 수 있는 그리기 도구가 없어 아직 만들 수 없어요.",
  recheck: "다시 확인",
  pickImage: "그림 고르기",
  charName: "이름",
  charInstrument: "밴드 악기",
  create: "만들기 시작 (약 5~10분)",
  createStill: "움직임 없는 캐릭터 만들기",
  stillOnlyNote: "Grok 없이 만들면 움직이지 않는 그림이고, 걸을 때는 통통 튀기만 해요.",
  stepSide: "옆모습 그리기",
  stepPlay: "악기 든 모습 그리기",
  stepChute: "낙하산 모습 그리기",
  stepIdle: "가만히 있는 움직임",
  stepWalk: "걷는 움직임",
  stepFall: "낙하산 움직임",
  stepPlayAnim: "연주 움직임",
  stepPack: "스프라이트 만들기",
  working: "이 창을 닫아도 숨겨질 뿐 작업은 계속돼요.",
  previewTitle: "미리보기",
  save: "이 캐릭터 저장",
  discard: "버리기",
  retry: "다시 시도",
  saved: "저장했어요! 펫 탭의 캐릭터나 밴드 멤버로 고를 수 있어요.",
  importTitle: "팩 가져오기",
  importFolder: "폴더에서",
  importZip: "zip에서",
  importHint: "idle.apng(필수)와 walk·fall·play.apng, pack.json이 든 폴더나 zip.",
  imported: "“{name}” 팩을 가져왔어요.",
  myPacks: "내 팩",
  noPacks: "아직 없어요.",
  remove: "삭제",
  usePet: "펫으로 쓰기",
  stopped: "멈췄어요: {reason}",
  errGrokAuth: "Grok 로그인이 거부됐어요. 터미널에서 grok login 후 다시 시도하세요.",
  errCodexAuth: "Codex 로그인이 만료됐어요. 터미널에서 codex login 후 다시 시도하세요.",
  pickFirst: "먼저 그림을 고르세요.",
  nameFirst: "캐릭터 이름을 적어 주세요.",
  creating: "만드는 중…",
  bgToggle: "◐ 배경 바꾸기",
  storeTitle: "🎸 밴드 팩 (유료)",
  storeLead: "OmO, 잡도리, 고양이 오모는 무료예요. 밴드 팩은 한 번 사면 오모의 밴드가 추가돼요.",
  storeUnlocks: "구매하면 열리는 것",
  storeItemFriends: "친구 넷: 달리(기타)·바라(베이스)·도치(드럼)·루파(키보드) — 펫으로도, 밴드 멤버로도",
  storeItemBand: "밴드 모드: 다섯이 작업 표시줄 위에 모여 짧은 오리지널 곡을 연주",
  storeItemSlots: "내 캐릭터 칸 제한 없음 (무료는 1칸)",
  storeFree: "사지 않아도 계속 쓸 수 있는 것",
  storeFreeOmo: "OmO, 잡도리, 고양이 오모의 모든 동작: 창 위 걷기, 로켓, 제트, 낙하산, 여러 모니터, 친구 부르기",
  storeFreeSlot: "내 캐릭터 1칸",
  storeWhere: "itch.io에서 ‘오모팻 밴드 팩’을 사면 라이선스 파일과 키를 받아요. 계정이나 인터넷 없이 이 컴퓨터에서 바로 확인해요.",
  licenseTitle: "라이선스",
  licenseNone: "이 컴퓨터에 라이선스가 없어요.",
  licenseActive: "✅ 밴드 팩이 열렸어요 ({id}). 다른 컴퓨터에서 다시 열 수 있게 라이선스 파일을 보관하세요.",
  licenseImport: "라이선스 파일 가져오기",
  licenseKeyPlaceholder: "…또는 라이선스 키를 붙여 넣으세요 (OMOPET1-…)",
  licenseApply: "키로 열기",
  licenseRemove: "이 컴퓨터에서 라이선스 지우기",
  licenseDone: "열렸어요! 밴드와 친구 넷을 쓸 수 있어요.",
  lockedPack: "밴드 팩에 들어 있어요",
  errLicense: "오모팻 라이선스가 아니에요. 키 전체(또는 라이선스 파일)를 넣었는지 확인하세요.",
  errSlotLimit: "무료 버전은 내 캐릭터를 1개까지 저장해요. 지우거나 밴드 팩(밴드 탭)을 열면 제한이 없어져요.",
  slotNote: "무료 버전: 내 캐릭터 {used}/1칸 사용 중. 밴드 팩을 열면 제한이 없어요.",
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
