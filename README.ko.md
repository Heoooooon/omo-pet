# omo-pet

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어**

**고양이 오모가 모니터 위에 삽니다.** 앱 창을 발판 삼아 노는 오픈소스 데스크톱 펫입니다.
오모는 창 위를 걸어 다니고, 로켓을 타고 다른 모니터로 날아갔다가, 낙하산을 펴고 천천히 내려옵니다.
iPad로 건너가기도 해요.

[Tauri 2](https://tauri.app)(투명 · 프레임리스 · 항상 위 창)와 바닐라 TypeScript로 만들었습니다.
omo-pet은 [hermes-pet](https://github.com/Heoooooon/hermes-pet)의 포크로,
기본 캐릭터가 새로 바뀌었고 로컬 캐릭터 팩을 지원합니다.

## 미리보기

<p align="center">
  <img src="docs/media/demo.gif" width="560" alt="고양이 오모가 걷고, 로켓과 제트를 타고, 낙하산으로 내려와 올라가 앉는 모습">
</p>
<p align="center"><sub>🚶 걷기 → 🚀 로켓 → ✈️ 제트 → 🪂 낙하산 → 올라가 앉기 (오모 팩 스프라이트)</sub></p>

모든 동작은 APNG 스프라이트입니다(여기서 바로 재생됩니다):

| idle | walk | rocket | jet | parachute | climb & sit |
| :-: | :-: | :-: | :-: | :-: | :-: |
| <img src="public/packs/omo-cat/idle.apng" width="72"> | <img src="public/packs/omo-cat/walk.apng" width="72"> | <img src="public/packs/omo-cat/rocket.apng" width="72"> | <img src="public/packs/omo-cat/jet.apng" width="96"> | <img src="public/packs/omo-cat/fall.apng" width="72"> | <img src="public/packs/omo-cat/edge.apng" width="72"> |

## 기능

- 🚶 **창 위를 걷기**: 실제 앱 창의 윗변을 발판으로 인식해서 올라가 걷고, 창이 움직이면 같이 이동
- 🪂 **낙하산**: 발판이 사라지거나 높은 곳에서 떨어질 때 낙하산을 펴고 내려옴
- 🚀 **로켓 & 제트**: 수직으로 솟구치는 로켓 발사, 옆으로 내달리는 제트 대시
- 🖥️ **멀티 모니터**: 배율이 다른 모니터(레티나 + 외장) 사이를 넘나듦. 좌우 배치도, 위아래로 쌓은 배치도 지원
- 📱 **iPad 핸드오프**: Lanbeam 에이전트(별도 프로젝트)가 실행 중이면 화면 끝에서 iPad로 건너감(선택 기능, 없어도 모든 기능이 동작)
- 🎛️ **설정 GUI**: 우클릭 → 설정에서 캐릭터를 바꾸고 크기·속도·활동성·묘기 빈도를 실시간으로 조절
- 🎭 **캐릭터 팩**: `public/packs/<name>/`에 동작별 APNG를 넣으면 새 캐릭터가 됩니다
- 🐾 **친구 소환**: 성격(크기·걸음걸이)이 조금씩 다른 친구를 최대 3마리까지 추가
- 🔍 **인식 오버레이**: 어떤 창을 발판으로 보는지 모니터별 오버레이로 표시
- ✋ **드래그 / 💖 클릭 반응**: 집어 들면 대롱대롱 매달리고, 클릭하면 하트를 보냄
- 🎸 **밴드 모드**: 트레이나 우클릭 메뉴의 "밴드 열기"(가끔은 저절로)를 누르면 오모(보컬)와 친구 넷(달리 기타 · 바라 베이스 · 도치 드럼 · 루파 키보드)이 화면 끝에서 걸어와 작업표시줄 위에 모입니다. 작은 무대에서 약 20초 동안 함께 연주한 뒤 인사하고 돌아갑니다. 노래는 앱 안에서 직접 합성하고, 소리는 꺼진 채 시작하니 무대 위 "소리 켜기"로 켜세요.
- 🧑‍🎨 **내 캐릭터 만들기**: 설정 › 내 캐릭터에서 그림 한 장을 고르면, 내 컴퓨터에서 **내 Grok 로그인**(그림은 Codex CLI도 가능)으로 대기·걷기·낙하산·악기 연주 스프라이트를 만듭니다. 결과물은 내 컴퓨터에만 저장되고, 직접 그렸거나 권리가 있는 그림만 쓸 수 있어요. 폴더나 zip으로 된 팩도 가져올 수 있습니다([팩 형식](docs/pack-format.md)).

## 시작하기

요구 사항: [Node.js](https://nodejs.org) 18+, [Rust](https://rustup.rs) 툴체인.

```bash
npm install
npm run tauri dev     # run in development mode
npm run tauri build   # build a release app
```

- 조작: 드래그로 이동 · 클릭하면 반응 · **우클릭**으로 메뉴(Friend+ / 설정 / 인식 오버레이 / 종료)
- UI 언어: **설정 → 언어**에서 영어·한국어를 선택하면 저장됩니다. 기본은 영어이며 시스템 언어가 한국어이면 한국어로 시작합니다.
- 창 감지는 공개 API만 사용하므로 추가 권한이 필요 없습니다
  (macOS `CGWindowListCopyWindowInfo` / Windows `EnumWindows` + DWM).
- 주 대상은 macOS입니다. Windows 빌드는 실험 단계예요(창 감지 코드는 컴파일되지만 실제 기기에서는
  아직 테스트하지 않았습니다). Windows 빌드 방법은
  [hermes-pet README](https://github.com/Heoooooon/hermes-pet#getting-started)를
  참고하세요. 여기서도 똑같습니다.

## 나만의 캐릭터 넣기

팩은 `public/packs/<pack>/<state>.apng` 형태로 스프라이트를 모아 둔 폴더입니다
(idle / walk / drag / react / fall / edge / rocket / jet, 그리고 선택 사항인
`fall-open` / `fall-glide` / `fall-land` 단계). 빠진 동작은 idle로 대신하고,
변형(`<state>.2.apng` … `<state>.4.apng`)은 무작위로 골라 씁니다.
팩은 **설정 › 내 캐릭터 › 팩 가져오기**로 넣습니다(폴더나 zip, [팩 형식](docs/pack-format.md)).
배포 빌드에는 오리지널 팩만 들어가며, 다른 팩이 섞이면 `scripts/check-bundle.mjs`가 빌드를 실패시킵니다.

오모 팩은 [sprite-gen](https://github.com/aldegad/sprite-gen)으로 만들었습니다.
정지 이미지 한 장(`art/omo-cat/base.png`) → 동작마다 sprite-gen 한 번 실행
(`art/sprites/omo-<state>/`, 요청 + 프롬프트 + 원본 줄 이미지 + 프레임) → `ffmpeg`로 APNG 변환.
전체 레시피는 `.claude/skills/add-action/SKILL.md`에 있습니다.

## 프로젝트 구조

```
src/main.ts              Behavior brain: state machine, window-platform physics,
                         multi-monitor crossing, Lanbeam handoff, pack loading
src/style.css            Per-state CSS motion and per-pack sprite sizes
src/settings.ts          Settings panel (packs, band pack license, My character)
src-tauri/               Tauri shell: transparent window, window list, Lanbeam bridge client
public/packs/omo-cat/    The bundled Omo pack (APNG per action)
art/                     Omo source still + sprite-gen run records
```

## 크레딧

- **[hermes-pet](https://github.com/Heoooooon/hermes-pet)**(MIT) 기반:
  데스크톱 펫 엔진, 창 발판 물리, 멀티 모니터·iPad 기능
- **스프라이트 생성**: [sprite-gen](https://github.com/aldegad/sprite-gen)(@aldegad)
- **오모**는 CMORE의 오리지널 캐릭터입니다

## 라이선스

[MIT](./LICENSE): 코드와 오모 아트워크(`art/`,
`public/packs/omo-cat/`)에 적용됩니다.
