# MaskyVue

Masky の本番ユーザーGUI（Vue 3 + Vite + TypeScript）。
MaskyFlutter を参照実装（仕様書）とし、最終的に Flutter を置き換える。詳細は親フォルダの [../plan.md](../plan.md) を参照。

## 現状: M1（疎通）

- `user-api`（FastAPI, port 6629）への接続を **Vite dev proxy 経由**で確立する最小構成。
- ブラウザからは同一オリジンの `/api/...` を叩き、Vite が `http://localhost:6629` へ転送する（CORS 非依存・バックエンド無改変）。
- 画面はまだ疎通確認ボタン1つのみ。

## 開発

```sh
npm install
npm run dev      # http://localhost:53334 （Flutter dev の 53333 と衝突しない）
```

`user-api` を先に起動しておき、画面の「GET /api/ を叩く」ボタンで `"OK"` が返れば疎通成功。

- 接続先を変える場合: `VITE_API_TARGET=http://別ホスト:6629 npm run dev`
- ビルド + 型チェック: `npm run build`

## 主要ファイル

- [vite.config.ts](vite.config.ts) — dev server ポート（53334）と `/api` プロキシ設定
- [src/App.vue](src/App.vue) — 疎通確認 UI
