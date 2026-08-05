# MaskyVue

Masky の本番ユーザーGUI（Vue 3 + Vite + TypeScript）。
MaskyFlutter を参照実装（仕様書）とし、最終的に Flutter を置き換える。詳細は本リポジトリと同じ階層に置かれる
`ID-AI-Masky` 作業フォルダの `plan.md` を参照（別リポジトリのため直リンクなし）。
接続の仕組みは [ARCHITECTURE.md](ARCHITECTURE.md) を参照。

## 現状

`user-api`（FastAPI, port 6629）と疎通し、`ID-AI-Masky` 作業フォルダの `ui-ux-requirements.md` と
モック（`index-03.html`）に基づく4画面をひととおり実装済み（いずれも別リポジトリのため直リンクなし）。

- **新しいタスク（アップロード）**: 画像 / ZIP（再帰展開） / PDF / Office をまとめて登録し、検知対象（目・文字）とチェックのみ／チェック＋マスクを選択してキューへ送信する。
- **作業キュー**: 全ジョブ（自分のみ／全員切替可）の状態一覧。実行中ジョブがある間、8秒間隔で自動更新（カウントダウン表示）。トークンによる一時停止／再開／キャンセル／優先実行。
- **処理結果**: タスク → アップロードファイル → 画像の3階層ドリルダウン。絞り込み・検索・ページング、Before/After比較、マスク済み画像の一括ダウンロード（ZIP生成）。
- **共通設定**: ライセンス状態表示・登録。正規表現パターンの複数管理（`/regex-patterns` の追加・編集・削除・初期値リセット、
  全ユーザー共有）。「新しいタスク」画面にも同じ管理機能を内包した選択ダイアログがあり
  （MaskyFlutter `lib/widgets/settings.dart` と同じ構成）、登録済みパターンから複数選択してOR条件で照合する。

## 開発

```sh
npm install
npm run dev      # http://localhost:53334 （Flutter dev の 53333 と衝突しない）
```

`user-api` を先に起動しておくこと。

- 接続先を変える場合: `VITE_API_TARGET=http://別ホスト:6629 npm run dev`
- ビルド + 型チェック: `npm run build`

## 主要ファイル

- [vite.config.ts](vite.config.ts) — dev server ポート（53334）と `/api` プロキシ設定
- [src/App.vue](src/App.vue) — アプリシェル（サイドバー・タブ切替）とアップロード画面
- [src/components/JobListPanel.vue](src/components/JobListPanel.vue) — 作業キュー
- [src/components/TaskResultsBrowser.vue](src/components/TaskResultsBrowser.vue) — 処理結果（タスク一覧・タスク詳細）
- [src/components/ResultExplorer.vue](src/components/ResultExplorer.vue) — 処理結果（ファイル→画像ドリルダウン）
- [src/components/FlowNav.vue](src/components/FlowNav.vue) — 処理結果画面の現在地ナビ（タスク→ファイル→画像）
- [src/components/SettingsPage.vue](src/components/SettingsPage.vue) — 共通設定・正規表現パターン管理・ライセンス
- [src/composables/useRegexPatterns.ts](src/composables/useRegexPatterns.ts) — 正規表現パターン一覧（App.vue/SettingsPage.vueで共有）
- [src/api/](src/api/) — user-api との通信（`http.ts` が土台、`userApi.ts` が個々のエンドポイント）
- [src/types/processJob.ts](src/types/processJob.ts) — ジョブ関連のレスポンス型とパース関数
