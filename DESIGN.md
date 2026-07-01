---
name: "Masky Design System"
description: "Masky（Vue フロントエンド）の UI デザイン統一ルール。色・文字・余白・コンポーネントの実装値をここで一元管理する。"

colors:
  primary: "#078017"      # TODO: MaskyFlutter の seed color (ARGB 255,7,128,23) を踏襲する場合の例。要確認・要決定
  secondary: "#TODO"
  background: "#TODO"
  surface: "#TODO"
  error: "#TODO"
  warning: "#TODO"
  success: "#TODO"
  onPrimary: "#TODO"
  onBackground: "#TODO"
  outline: "#TODO"

typography:
  fontFamily: "TODO: system-ui, sans-serif など"
  headline:
    size: "TODO"
    weight: "TODO"
  title:
    size: "TODO"
    weight: "TODO"
  body:
    size: "TODO"
    weight: "TODO"
  caption:
    size: "TODO"
    weight: "TODO"

spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"

rounded:
  sm: "4px"
  md: "8px"
  lg: "16px"
  pill: "999px"

components:
  button:
    height: "TODO"
    rounded: "pill"
    padding: "TODO"
  card:
    rounded: "md"
    border: "TODO"
  input:
    height: "TODO"
    rounded: "sm"
---

<!--
  このファイルの使い方:
  - 上の YAML フロントマターは「機械可読なデザイントークン」。実装（CSS変数・Vuetifyテーマ等）はここの値を正として参照する。
  - 下の Markdown 本文は「人間可読な意図の説明」。数値だけでは伝わらない、なぜその色・余白・雰囲気にしたのかを書く。
  - TODO は未決定値。決まり次第、この TODO を消して値を確定させること。
-->

## Overview

<!-- デザインシステム全体の方針・世界観を簡潔に。例: 誰向けの画面か（院内スタッフ）、どんな印象を狙うか（信頼感・誤操作の防止 等） -->

TODO: Masky の UI が目指す全体方針を記述する。

- 想定ユーザー: TODO（例: 病院スタッフ、専門知識のない現場担当者）
- 狙う印象: TODO（例: 誤操作を防ぐ、処理状況が一目でわかる）
- 参照する既存実装: MaskyFlutter（[../MaskyFlutter](../MaskyFlutter)）の見た目をどこまで踏襲するかは要決定（[plan.md](../plan.md) §5-3 UIライブラリ選定と連動）。

## Colors

<!-- 各色をどこで使うか。HEXの意味と用途をセットで書く -->

| トークン | 用途 |
|---|---|
| `primary` | TODO（例: 主要アクションボタン、選択状態） |
| `secondary` | TODO |
| `background` | TODO |
| `surface` | TODO（カード等の背景） |
| `error` | TODO（失敗トースト、バリデーションエラー） |
| `warning` | TODO（ファイル未選択等の警告） |
| `success` | TODO（処理成功） |

## Typography

<!-- 見出し／本文／キャプション等の役割と使い分け -->

| トークン | 用途 |
|---|---|
| `headline` | TODO（例: ページタイトル「マスキー」） |
| `title` | TODO（例: セクション見出し「作業内容」「対象」） |
| `body` | TODO（本文、ボタンラベル） |
| `caption` | TODO（補足説明、ファイルサイズ表記など） |

## Layout

<!-- グリッド、コンテナ幅、余白のルール、配置の原則 -->

TODO:
- コンテナの最大幅
- レスポンシブの分岐点（縦持ち/横持ち、モバイル対応の要否）
- `spacing` トークンの使い分けルール（例: コンポーネント内側は `sm`、セクション間は `lg`）

## Elevation & Depth

<!-- シャドウやレイヤーの段階、奥行き表現の方針 -->

TODO: モーダル・ドロップダウン・カードなどの重なり順とシャドウの強さを定義する。

## Shapes

<!-- 角丸・枠線のルール。どのコンポーネントをどの丸みで作るか -->

| トークン | 適用対象 |
|---|---|
| `rounded.sm` | TODO（例: 入力欄） |
| `rounded.md` | TODO（例: カード、プレビュータイル） |
| `rounded.lg` | TODO |
| `rounded.pill` | TODO（例: 実行ボタン） |

## Components

<!-- ボタン・カード・フォーム・ナビゲーション等、代表コンポーネントの見た目と状態（通常/ホバー/無効/エラー） -->

### Button

- TODO: 通常状態、押下中、無効状態の見た目差分

### Card

- TODO: プレビュータイル・結果カード等の共通スタイル

### Form / Input

- TODO: regex 入力欄、シリアル番号入力欄などのスタイル

### Navigation

- TODO: ヘッダー、画面遷移（メイン/ジョブ履歴/結果/ライセンス）の見た目

## Do's and Don'ts

<!-- やってほしいこと・やってはいけないことを具体例付きで -->

**Do**
- TODO

**Don't**
- TODO
