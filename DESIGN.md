---
name: "Masky Design"
description: "Masky（Vue Frontend）の UI デザイン統一ルール。色・文字・余白・コンポーネントの実装値をここで一元管理する。"

colors:
  primary: "#007BA7"       # セルリアン。ブランドカラー兼メインアクション色
  secondary: "#52606D"
  background: "#F7F9FC"
  surface: "#FFFFFF"
  error: "#C44747"
  warning: "#FFF3B8"       # 背景は淡黄。文字色は warningDeep を使う
  success: "#2F7D4A"
  info: "#007BA7"          # primary と同一
  text: "#17202A"
  onPrimary: "#FFFFFF"
  muted: "#52606D"
  border: "rgba(215, 222, 232, 0.96)"
  warningDeep: "#B7791F"   # warning 背景上の文字色
  danger: "#C44747"        # error のエイリアス（旧実装で名称混在）

typography:
  fontFamily: "\"BIZ UDPGothic\", \"Hiragino Sans\", \"Yu Gothic UI\", sans-serif"
  headline:
    size: "clamp(1.75rem, 2vw, 2.2rem)"
    weight: 700
    note: "大文字化 + letter-spacing 0.08em（ヘッダーのブランド表記用）"
  title:
    size: "1rem"
    weight: 700
    note: "letter-spacing 0.02em（セクション見出し）"
  body:
    size: "0.9rem - 0.95rem"
    weight: 400
  caption:
    size: "0.78rem - 0.88rem"
    weight: 500-700

spacing:
  note: "旧実装は厳密なトークンスケールを持たず rem 単位で個別調整。目安として観測された値を残す。"
  xs: "0.35rem"
  sm: "0.55rem - 0.75rem"
  md: "0.85rem - 1.2rem"
  lg: "1.35rem - 1.5rem"
  xl: "2rem"

rounded:
  sm: "14px"    # ボタン
  md: "18px"    # 内包カード・アラートボックス
  lg: "24px"    # 大枠カード（Vuetify VCard rounded="xl" 相当）・ドロップゾーン
  pill: "999px" # ステータスバッジ・チップ

components:
  button:
    minHeight: "44px"
    rounded: "sm"
    textTransform: "none"
    fontWeight: 700
    variants: "primary=flat / secondary=outlined / ghost=text / danger=flat(error)"
  card:
    elevation: 0
    rounded: "lg"
    border: "1px solid var(--mk-border)"
    background: "surface, backdrop-filter: blur(14px)"
    shadow: "0 22px 46px rgba(23, 32, 42, 0.08)"
  statusBadge:
    rounded: "pill"
    pattern: "色付き背景 + ドット + ラベル。tone: active / inactive / checking"
  dropZone:
    rounded: "lg"
    activeState: "translateY(-2px) + border強調"
    disabledOpacity: 0.68

library: "Vuetify 3（vuetify, vite-plugin-vuetify, @mdi/font）"
---

<!--
  このファイルの使い方:
  - 上の YAML フロントマターは「機械可読なデザイントークン」。実装（CSS変数・Vuetifyテーマ等）はここの値を正として参照する。
  - 下の Markdown 本文は「人間可読な意図の説明」。数値だけでは伝わらない、なぜその色・余白・雰囲気にしたのかを書く。
  - この内容は、Kと正式合流する前に上司から聞いていたデザイン構想を元に作成した旧プロトタイプ
    （C:\Users\uid7773\Desktop\vsc_work\Masky\Work\Masky\frontend）から輸入したもの。
    コード自体は移植していない（構想・トークンのみ）。実装時に再検証すること。
-->

## Overview

- 想定ユーザー: 病院スタッフなど専門知識のない現場担当者（[FaceMask/README.md](../FaceMask/README.md) 「目的」参照）。
- 狙う印象: 誠実で落ち着いた業務系アプリ。エラー/警告/成功を色でわかりやすく区別し、誤操作を防ぐ。
- ブランド: ヘッダー全体をアクセントカラー（セルリアンブルー #007BA7）で塗り、白抜き大文字ロゴ「MASKY」を表示する構成。
- フォント: BIZ UDPGothic（UD=ユニバーサルデザインフォント）を第一候補にする。可読性重視の業務アプリ向けの明示的な選択。
- UI ライブラリ: **Vuetify 3** で確定（旧プロトタイプで採用済み）。[plan.md](../plan.md) §5-3 の未決定事項はこれで解消。アイコンは `@mdi/font`。
- MaskyFlutter とは配色方針が異なる（Flutterは緑、旧プロトタイプは青系）。どちらに寄せるかは要相談（下記「未決定・要確認」参照）。

## Colors

| トークン | 用途 |
|---|---|
| `primary` / `info` | 主要アクションボタン、ブランド、リンク |
| `secondary` | 補助アクション（アウトライン/テキストボタン）、ミュートテキスト |
| `background` | ページ全体の背景 |
| `surface` | カード・パネルの背景（半透明+ぼかしで使うことが多い） |
| `success` | 処理成功、ライセンス有効状態 |
| `warning` / `warningDeep` | ファイル未選択・ブロック等の警告。背景は淡黄、文字は `warningDeep` |
| `error` / `danger` | 失敗トースト、バリデーションエラー、ライセンス無効状態 |
| `text` | 基本文字色 |
| `border` | カード・入力欄の枠線 |

## Typography

| トークン | 用途 |
|---|---|
| `headline` | アプリブランド表記（ヘッダーの「MASKY」）。大文字+太字+レタースペーシング広め |
| `title` | セクション見出し（例:「作業内容」「対象」相当）。太字・控えめなレタースペーシング |
| `body` | 本文、ボタンラベル、フォーム |
| `caption` | ステータステキスト、フッターの著作権表記など補足情報 |

## Layout

- 画面全体をヘッダー / メインコンテンツ / フッターの3段グリッド（`grid-template-rows: auto 1fr auto`, `min-height: 100vh`）で構成。
- ヘッダー・フッターは共に `primary` 色で塗る（帯状のブランドカラー）。
- レスポンシブ分岐点: `900px`（余白縮小）、`640px`（ヘッダーを折り返し、幅100%に）。
- 余白は §Spacing の目安どおり、旧実装では厳密なスケールは未整備。今後トークン化する際に統一するかは要検討。

## Elevation & Depth

- Vuetify のマテリアル的な `elevation` は使わず、**`elevation: 0` + 独自の box-shadow** で奥行きを表現する（フラット×柔らかい影のスタイル）。
- カード等の `surface` 要素には `backdrop-filter: blur(14px)` を重ね、半透明のすりガラス調にする。
- 影の強さは統一値: `0 22px 46px rgba(23, 32, 42, 0.08)`。

## Shapes

| トークン | 適用対象 |
|---|---|
| `rounded.sm`（14px） | ボタン |
| `rounded.md`（18px） | 警告/情報ボックス、埋め込み型の内包カード |
| `rounded.lg`（24px） | 大枠カード（Vuetify `VCard rounded="xl"` 相当）、ファイルドロップゾーン |
| `rounded.pill`（999px） | ステータスバッジ、チップ、状態表示ピル |

## Components

### Button

- 4種の `tone`: `primary`（flat）/ `secondary`（outlined）/ `ghost`（text）/ `danger`（flat, error色）。
- 共通: `min-height: 44px`、角丸 14px、`text-transform: none`（大文字化しない）、`font-weight: 700`。
- `primary` のみ色付きの浮遊感のある shadow を追加。

### Card

- `elevation: 0` + カスタム shadow、角丸 24px（Vuetify `VCard` の既定 `rounded="xl"`）、`border: 1px solid var(--mk-border)`。

### Form / Input

- ドロップゾーン（ファイル選択）: 角丸24px、ドラッグ中は `translateY(-2px)` + 枠線強調、無効時は `opacity: 0.68`、`focus-visible` で明確なアウトライン（アクセシビリティ配慮）。

### Navigation

- ヘッダー: `primary` 背景、白抜き大文字ブランド名、右側にライセンス状態バッジ+クイックメニュー。
- ライセンス状態バッジ: pill形状、ドット+ラベル、`active`（緑系）/`inactive`（警告系）/`checking`（中間色）の3トーン。
- フッター: `primary` 背景、中央寄せの著作権表記。

## Do's and Don'ts

**Do**
- 警告・エラー・成功は色 + アイコン/ドットの両方で示す（色だけに依存しない）。
- インタラクティブ要素には `focus-visible` の明確なアウトラインを必ず用意する。
- Vuetify のデフォルトスタイル（角丸・elevation）を尊重しつつ、`defaults` でプロジェクト共通値に統一する。

**Don't**
- ボタンラベルを大文字変換しない（`text-transform: none` を崩さない）。
- Vuetify 標準の `elevation` を単体で使わない（本プロジェクトはフラット+独自shadowで統一）。
- warning色を単独の判断材料にしない（`warningDeep` の文字色とセットで可読性を確保する）。

## 未決定・要確認

- MaskyFlutter（緑基調）と本デザイン構想（青基調）のどちらに配色を寄せるか、あるいは新規に配色し直すか。
- 旧プロトタイプのコード自体（`src/`）を実装のたたき台として本格的に移植するか、Vue雛形から作り直すか。
- Spacing の厳密なトークン化（旧実装は未整備のため）。
