---
name: add-action
description: omo-pet 데스크톱 펫에 새 행동 스프라이트를 추가한다. 두 가지 입력을 지원 — (A) 행동 설명만 주면 sprite-gen + codex image_gen으로 프레임을 생성, (B) 사용자가 준 GIF(마젠타 배경)를 변환. 결과는 public/packs/<pack>/<state>.apng + 상태 머신 연결. "새 동작 추가", "스프라이트 만들어줘", "이 GIF 넣어줘" 요청에 사용.
---

# add-action — 펫 행동 스프라이트 추가 파이프라인

omo-pet의 모든 행동 에셋(walk, rocket, jet, fall, edge...)은 이 파이프라인으로 만들어졌다.
두 모드가 있다. 사용자가 GIF/이미지를 줬으면 모드 B, 설명만 줬으면 모드 A.

## 공통 준비

- sprite-gen 도구가 필요하다. 없으면 클론:
  ```bash
  git clone --depth 1 https://github.com/aldegad/sprite-gen ~/.cache/sprite-gen
  ```
  이미 있으면 `git -C ~/.cache/sprite-gen pull --ff-only`로 갱신만 한다.
- 실행은 항상 `uv run --with "pillow>=12,<13" python3 scripts/<tool>.py` 형태로 sprite-gen 디렉토리에서.
- 캐릭터 아이덴티티 기준 이미지: `art/omo-cat/base.png` (걷기 측면 전신).
  전혀 다른 포즈 계열이면 사용자에게 새 베이스를 요청해도 된다.

## 모드 A: 행동 설명 → 프레임 생성 (sprite-gen + codex)

1. **run 준비.** 상태별로 새 run 디렉토리를 쓴다 (`art/sprites/omo-<state>`):
   ```bash
   cd ~/.cache/sprite-gen && uv run --with "pillow>=12,<13" python3 scripts/prepare_sprite_run.py \
     --out-dir <repo>/art/sprites/omo-<state> \
     --character-id omo-<state> \
     --base-image <repo>/art/omo-cat/base.png \
     --description "<description from art/sprites/omo-idle/sprite-request.json>" \
     --request-json '<아래 참고>' \
     --force
   ```
   request JSON 요점 (⚠️ 후행 콤마 금지 — 한 번 당했다):
   - 단순 제스처: frames 4, fps 6~8, loop는 복귀 프레임 있을 때만 true
   - 루프 모션(비행·걷기류): frames 4~6, fps 8~10, loop true
   - cell: 세로 포즈 `{"shape":"rect","width":192,"height":256,...}`,
     가로 포즈(탈것) `{"shape":"rect","width":256,"height":176,...}`,
     걷기류 `192x208` + `--fit-align-x foot-centroid --fit-align-y bottom` (지터 방지, SKILL.md 권장)
   - 탈것/부유 포즈는 `--fit-align-x centroid --fit-align-y center`
   - action 문구에 "only the X change between frames, pose stays fixed"를 넣으면 프레임 간 붕괴가 줄어든다.

2. **codex로 행(row) 생성.** codex CLI에 `image_gen` 도구가 있다. 프롬프트는 stdin으로
   (⚠️ `-i` 플래그가 위치 인자를 삼키므로 인자로 주면 안 된다):
   ```bash
   cd <run-dir> && codex exec --skip-git-repo-check --sandbox workspace-write \
     -i base-source.png -i references/layout-guides/<state>.png - <<'EOF'
   You are running one step of the sprite-gen pipeline. The file prompts/<state>.txt ... (프롬프트를 읽고 image_gen 호출, ./raw/<state>.png에 저장, 크기 출력)
   EOF
   ```
   ⚠️ **이중 저장 함정**: codex는 중간 저장 후 종료 직전에 최종본을 다시 저장한다.
   `raw/<state>.png`가 생겨도 **codex 프로세스가 완전히 종료할 때까지 기다린 뒤** 추출하라.
   (추출을 먼저 했다면 raw mtime과 산출물 mtime을 비교해 재추출.)

3. **결과 검토.** 생성된 row를 sips로 축소해 눈으로 확인 — 아이덴티티(H 헤드폰, 가방, 팔레트),
   프레임 수, 가이드 박스 유출 여부. 나쁘면 재생성 (로컬 수정 금지 — sprite-gen 규칙).

4. **추출 + 조립:**
   ```bash
   uv run ... scripts/extract_sprite_row_frames.py --run-dir <run-dir>   # ok:true, warnings 0 확인
   ffmpeg -y -framerate <fps> -i <run-dir>/frames/<state>/frame-%d.png \
     -c:v apng -plays <0|1> <repo>/public/packs/<pack>/<state>.apng
   ```
   `-plays 0` = 무한 루프(대기·비행), `-plays 1` = 1회 재생 후 마지막 프레임 유지(낙하산·등반 같은 원샷).
   ⚠️ frame-%d는 0부터 시작한다 (클린업된 파일명이 1부터면 `-start_number 1`).

5. **모션 QA.** `scripts/preview_animation.py`로 contact sheet 생성 후 확인. locomotion이면
   몸이 셀 안에서 좌우로 흔들리는 지터를 반드시 확인 (`foot-centroid` 재추출로 해결).
   미묘하면 큐레이션 웹뷰(`scripts/serve_curation.py --run-dir ... --lang ko`)를 띄워 사용자에게 넘긴다.

## 모드 B: 사용자 GIF → APNG 변환

사용자 GIF는 보통 순수 마젠타 `#FF00FF` 배경, 512x512, ~12프레임, 50/3fps다.

```bash
# 1. 크로마키 (정확한 배경색은 코너 픽셀 샘플로 확인)
ffmpeg -i in.gif -vf "colorkey=0xFF00FF:0.12:0.08" key_%02d.png
# 2. 디스필 — 그림자·가장자리의 마젠타 잔류를 중성화: spill = min(R,B) - G > 0 이면 R,B에서 spill 차감
#    (uv run --with pillow 인라인 스크립트; art/ 히스토리의 despill.py 참고)
# 3. 조립
ffmpeg -framerate 50/3 -start_number 1 -i clean_%02d.png -c:v apng -plays <0|1> public/packs/<pack>/<state>.apng
```

원본 GIF는 `art/<state>-original.gif`로 보관한다.

## 앱 연결 (양 모드 공통)

1. `src/main.ts`의 `SPRITES` 맵에 `<state>: "/<state>.apng"` 추가.
   원샷(plays 1)이면 `ONE_SHOT` 셋에도 추가 (재진입 시 캐시버스터로 재생 리셋).
2. State 유니온 타입에 추가하고 트리거 로직 작성 (scheduleNext 확률 롤 or 이벤트 트리거).
3. `src/style.css`: 드로잉된 모션이면 `body[data-state="<state>"].has-<state> #pet { animation: none; }`
   (CSS 눈속임 모션과 충돌 방지). 스프라이트 종횡비가 다르면 여기서 width 조정.
4. `npx tsc --noEmit` 통과 확인. dev 앱이 떠 있으면 vite가 코드는 핫리로드하지만
   public/ 에셋 교체는 안 잡는다 — `touch src/main.ts`로 강제 리로드.
5. iPad(keydeck)에도 필요하면: APNG를 `keydeck/Apps/iOS/PetResources/pet-<state>.apng`로 복사,
   `pet.html`의 미니 상태 머신에 로직 추가, `xcodegen generate` 후 iOS 빌드.

## 완료 기준

- [ ] 추출 리포트 ok:true, warnings 0
- [ ] contact sheet에서 아이덴티티·모션 확인 (locomotion은 지터 체크)
- [ ] APNG가 raw 최종본 기준인지 mtime 확인 (codex 이중 저장)
- [ ] tsc 통과 + 앱에서 실제 재생 확인
- [ ] `art/`에 소스 보존, 커밋
