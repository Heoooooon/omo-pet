# omo-pet

[English](README.md) · [简体中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md)

**ネコのオモが、あなたのモニターに住みつきます。** アプリのウィンドウを足場にして遊ぶ、
オープンソースのデスクトップペットです。オモはウィンドウの上を歩き、ロケットで別のモニターへ飛んでいき、
パラシュートでふわりと降りてきます。iPad に飛び移ることだってできます。

[Tauri 2](https://tauri.app)（透明・フレームレス・常に最前面のウィンドウ）と素の TypeScript で作っています。
omo-pet は [hermes-pet](https://github.com/Heoooooon/hermes-pet) のフォークで、
新しいデフォルトキャラクターとローカルのキャラクターパックに対応しています。

## プレビュー

<p align="center">
  <img src="docs/media/demo.gif" width="560" alt="猫のオモが歩き、ロケットとジェットに乗り、パラシュートで降りて、よじ登って座る">
</p>
<p align="center"><sub>🚶 歩く → 🚀 ロケット → ✈️ ジェット → 🪂 パラシュート → よじ登って座る（オモパックのスプライト）</sub></p>

動作はすべて APNG スプライトです（このページでそのまま再生されます）：

| idle | walk | rocket | jet | parachute | climb & sit |
| :-: | :-: | :-: | :-: | :-: | :-: |
| <img src="public/packs/omo-cat/idle.apng" width="72"> | <img src="public/packs/omo-cat/walk.apng" width="72"> | <img src="public/packs/omo-cat/rocket.apng" width="72"> | <img src="public/packs/omo-cat/jet.apng" width="96"> | <img src="public/packs/omo-cat/fall.apng" width="72"> | <img src="public/packs/omo-cat/edge.apng" width="72"> |

## 機能

- 🚶 **ウィンドウの上を歩く**：実際のアプリウィンドウの上端を足場として認識し、よじ登って歩きます。ウィンドウが動けば一緒に移動します
- 🪂 **パラシュート**：足場が消えたときや高いところから落ちたときは、パラシュートでゆっくり降ります
- 🚀 **ロケットとジェット**：真上に打ち上がるロケットと、横に突っ走るジェットダッシュ
- 🖥️ **マルチモニター**：スケールの違うモニター（Retina + 外部ディスプレイ）の間も行き来します。横並びでも縦積みでも OK
- 📱 **iPad ハンドオフ**：Lanbeam エージェント（別プロジェクト）が動いていれば、画面の端から iPad へ飛び移ります（任意。なくても全機能が動きます）
- 🎛️ **設定 GUI**：右クリック → 設定 から、キャラクターの切り替えや、サイズ・速度・活発さ・技の頻度をリアルタイムで調整できます
- 🎭 **キャラクターパック**：`public/packs/<name>/` に動作ごとの APNG を置けば、新しいキャラクターになります
- 🐾 **仲間を呼ぶ**：性格（大きさ・歩き方）が少しずつ違う仲間を最大 3 匹まで追加できます
- 🔍 **認識オーバーレイ**：どのウィンドウが足場として扱われているか、モニターごとのオーバーレイで表示します
- ✋ **ドラッグ / 💖 クリックへの反応**：つまみ上げるとぶらぶら揺れて、クリックするとハートを返してくれます

## はじめかた

必要なもの：[Node.js](https://nodejs.org) 18 以上と [Rust](https://rustup.rs) ツールチェーン。

```bash
npm install
npm run tauri dev     # run in development mode
npm run tauri build   # build a release app
```

- 操作：ドラッグで移動 · クリックで反応 · **右クリック**でメニュー（Friend+ / 設定 / 認識オーバーレイ / 終了）
- UI 言語：**Settings（設定）→ Language（言語）**で英語・韓国語を切り替えると選択が保存されます。標準は英語で、システム言語が韓国語の場合は韓国語で起動します。
- ウィンドウの検出には公開 API だけを使うので、追加の権限はいりません
  （macOS `CGWindowListCopyWindowInfo` / Windows `EnumWindows` + DWM）。
- メインの対象は macOS です。Windows 版は実験段階です（ウィンドウ検出はコンパイルできますが、
  実機ではまだ試していません）。Windows でのビルド手順は
  [hermes-pet README](https://github.com/Heoooooon/hermes-pet#getting-started)
  を見てください。手順はこちらでもまったく同じです。

## 自分のキャラクターを使う

パックは `public/packs/<pack>/<state>.apng` にスプライトを置いたフォルダーです
（idle / walk / drag / react / fall / edge / rocket / jet。ほかに任意で
`fall-open` / `fall-glide` / `fall-land` の段階も使えます）。足りない動作は idle で代用され、
バリエーション（`<state>.2.apng` … `<state>.4.apng`）はランダムに選ばれます。
パックは **設定 › マイキャラクター › パックを読み込む** から追加します（フォルダーまたは zip、[パック形式](docs/pack-format.md)）。
リリースビルドにはオリジナルのパックだけが入り、それ以外が混ざると `scripts/check-bundle.mjs` がビルドを失敗させます。

オモのパックは [sprite-gen](https://github.com/aldegad/sprite-gen) で作りました。
静止画 1 枚（`art/omo-cat/base.png`）→ 動作ごとに sprite-gen を 1 回実行
（`art/sprites/omo-<state>/`。リクエスト、プロンプト、生の連続画像、フレーム）→ `ffmpeg` で APNG に変換、という流れです。
詳しいレシピは `.claude/skills/add-action/SKILL.md` にあります。

## プロジェクト構成

```
src/main.ts              Behavior brain: state machine, window-platform physics,
                         multi-monitor crossing, Lanbeam handoff, pack loading
src/style.css            Per-state CSS motion and per-pack sprite sizes
src/settings.ts          Settings panel (packs, band pack license, My character)
src-tauri/               Tauri shell: transparent window, window list, Lanbeam bridge client
public/packs/omo-cat/    The bundled Omo pack (APNG per action)
art/                     Omo source still + sprite-gen run records
```

## クレジット

- **[hermes-pet](https://github.com/Heoooooon/hermes-pet)**（MIT）がベースです。
  デスクトップペットのエンジン、ウィンドウ足場の物理、マルチモニターと iPad の機能はここから来ています
- **スプライト生成**：[sprite-gen](https://github.com/aldegad/sprite-gen)（@aldegad）
- **オモ**は CMORE のオリジナルキャラクターです
- **ジャブドリ（잡도리）** © Sisyphus Labs (OmO Native)、許可を得て使用しています

## ライセンス

[MIT](./LICENSE)：コードとオモのアートワーク（`art/`、
`public/packs/omo-cat/`）が対象です。ジャブドリ（`art/jabdori/`、`public/packs/jabdori/`）は MIT ではなく、
Sisyphus Labs の許可を得て同梱しています。
