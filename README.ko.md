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
  <img src="docs/media/demo.gif" width="560" alt="앱 창의 윗변을 따라 걷는 고양이 오모">
</p>
<p align="center"><sub>🚶 실제 앱 창의 윗변을 따라 걷는 오모</sub></p>

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

## 시작하기

요구 사항: [Node.js](https://nodejs.org) 18+, [Rust](https://rustup.rs) 툴체인.

```bash
npm install
npm run tauri dev     # run in development mode
npm run tauri build   # build a release app
```

- 조작: 드래그로 이동 · 클릭하면 반응 · **우클릭**으로 메뉴(Friend+ / 설정 / 인식 오버레이 / 종료)
- 창 감지는 공개 API만 사용하므로 추가 권한이 필요 없습니다
  (macOS `CGWindowListCopyWindowInfo` / Windows `EnumWindows` + DWM).
- 주 대상은 macOS입니다. Windows 빌드는 실험 단계예요(창 감지 코드는 컴파일되지만 실제 기기에서는
  아직 테스트하지 않았습니다). Windows 빌드 방법은
  [hermes-pet README](https://github.com/Heoooooon/hermes-pet#getting-started)를
  참고하세요. 여기서도 똑같습니다.

## 팬메이드 치이카와 팩(내 컴퓨터에서 만들기)

LINE 공식 치이카와·하치와레·우사기 움직이는 스티커의 미리보기 이미지를
로컬 캐릭터 팩으로 바꿀 수 있습니다:

```bash
node scripts/make-chiikawa-pack.mjs                  # chiikawa, hachiware, usagi
node scripts/make-chiikawa-pack.mjs usagi            # just one
node scripts/make-chiikawa-pack.mjs --generate-walk  # also draw a walk cycle with sprite-gen
node scripts/make-chiikawa-pack.mjs --remove         # delete them again
```

스크립트는 LINE STORE에서 스티커 이미지를 내 컴퓨터로 내려받아
`public/packs/<character>/`와 `public/packs/local.json`에 저장합니다.
그다음 설정에서 캐릭터를 고르면 됩니다. 스티커가 없는 동작은 idle 스프라이트로 대신합니다.
`--generate-walk`를 쓰려면 `ffmpeg`, [sprite-gen](https://github.com/aldegad/sprite-gen) 체크아웃
(`SPRITE_GEN_DIR`, `.venv`까지 설치된 상태), 로그인된 `codex` CLI가 필요합니다
(ChatGPT 구독을 쓰기 때문에 API 키도, 호출당 요금도 없습니다).

> **팬메이드 · 비공식 · 비상업 프로젝트입니다.** 이 프로젝트는 치이카와 권리자와 관계가 없으며
> 승인을 받지도 않았습니다. **이 저장소에는 치이카와 그림이 전혀 들어 있지 않습니다.**
> 이미지는 각 사용자가 자기 컴퓨터에 개인 용도로 내려받는 것이고, `public/packs/*`는 git에서 무시됩니다.
> 생성된 팩은 커밋하거나 재배포하지 말아 주세요. Chiikawa © nagano / chiikawa committee.

## 나만의 캐릭터 넣기

팩은 `public/packs/<pack>/<state>.apng` 형태로 스프라이트를 모아 둔 폴더입니다
(idle / walk / drag / react / fall / edge / rocket / jet, 그리고 선택 사항인
`fall-open` / `fall-glide` / `fall-land` 단계). 빠진 동작은 idle로 대신하고,
변형(`<state>.2.apng` … `<state>.4.apng`)은 무작위로 골라 씁니다.
`public/packs/local.json`에 팩을 적어 두면 설정에 나타납니다:

```json
[{ "id": "my-pack", "name": "My pack", "emoji": "🦊" }]
```

오모 팩은 [sprite-gen](https://github.com/aldegad/sprite-gen)으로 만들었습니다.
정지 이미지 한 장(`art/omo-cat/base.png`) → 동작마다 sprite-gen 한 번 실행
(`art/sprites/omo-<state>/`, 요청 + 프롬프트 + 원본 줄 이미지 + 프레임) → `ffmpeg`로 APNG 변환.
전체 레시피는 `.claude/skills/add-action/SKILL.md`에 있습니다.

## 프로젝트 구조

```
src/main.ts              Behavior brain: state machine, window-platform physics,
                         multi-monitor crossing, Lanbeam handoff, pack loading
src/style.css            Per-state CSS motion and per-pack sprite sizes
src/settings.ts          Settings panel (packs from packs.json + local.json)
src-tauri/               Tauri shell: transparent window, window list, Lanbeam bridge client
public/packs/omo-cat/    The bundled Omo pack (APNG per action)
scripts/                 make-chiikawa-pack.mjs (local fan-made packs)
art/                     Omo source still + sprite-gen run records
```

## 크레딧

- **[hermes-pet](https://github.com/Heoooooon/hermes-pet)**(MIT) 기반:
  데스크톱 펫 엔진, 창 발판 물리, 멀티 모니터·iPad 기능
- **스프라이트 생성**: [sprite-gen](https://github.com/aldegad/sprite-gen)(@aldegad)
- **오모**는 CMORE의 오리지널 캐릭터입니다
- Chiikawa © nagano / chiikawa committee(팬메이드 로컬 팩 전용, 저장소에 포함되지 않음)

## 라이선스

[MIT](./LICENSE): 코드와 오모 아트워크(`art/`,
`public/packs/omo-cat/`)에 적용됩니다. 치이카와 스크립트로 로컬에서 만든 캐릭터는
각 권리자에게 속하며 이 라이선스의 대상이 아닙니다.
