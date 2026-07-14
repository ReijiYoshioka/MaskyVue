# FaceMask（バックエンド）と MaskyVue（フロントエンド）の接続の仕組み

ブラウザから FaceMask のバックエンドまで、リクエストは **4つの層** を通る。

```
[1] ブラウザ (Vue画面)
     │  fetch('/api/file-processing-jobs')  ← 自分のオリジン(53334)への相対パス
     ▼
[2] Vite dev server (Windows上, port 53334)
     │  プロキシ: /api を剥がして http://localhost:6629 へ転送
     ▼
[3] WSL2 の localhost forwarding (wslrelay.exe)
     │  Windowsの localhost:6629 → WSL2内の 6629 へ中継
     ▼
[4] user-api コンテナ (WSL2内Docker, FastAPI)
     │  さらに内部で mask-eyes(6620) / ocrmask(6621) へHTTP転送
     ▼
     AI処理 (顔検出モデル / OCRモデル)
```

## 各層の役割

### [1] Vueアプリ（ブラウザ側）

コードは接続先のホスト名やポートを一切知らない。[src/api/http.ts](src/api/http.ts) が全てのURLに `/api` を前置するだけ（`/api/file-processing-jobs` のような **自分自身のオリジンへの相対パス**）。バックエンドがどこにいるかは完全に下の層へ委ねる。

### [2] Vite dev server のプロキシ（この仕組みの心臓部）

[vite.config.ts](vite.config.ts) の `server.proxy` 設定。`/api` で始まるリクエストを受けたら、`/api` を剥がして `http://localhost:6629` へ転送する。

最大の目的は **CORS回避**。ブラウザは「ページのオリジン(53334)と違うオリジン(6629)へのfetch」をセキュリティ制約(CORS)で制限するが、この構成ではブラウザから見た通信相手は常に自分のオリジン(53334)のみ。オリジンをまたぐのはサーバー同士（Vite→user-api）の通信であり、そこにCORSは存在しない。そのため user-api 側の CORS 設定（`endpoints.py` 末尾の許可リスト）に Vue のポートを追加してもらう必要がない。

- 接続先の変更: `VITE_API_TARGET=http://別ホスト:6629 npm run dev`

### [3] WSL2 の localhost forwarding

user-api は Windows 上ではなく WSL2 内の Docker で動いているが、WSL2 には「WSL2内で公開されたポートを Windows の `localhost` へ自動中継する」機能がある（実体は `wslrelay.exe`）。おかげで Vite は相手が WSL2 内に居ることを意識せず `localhost:6629` へ送るだけで届く。

前提: FaceMask の docker-compose で `user-api` が `0.0.0.0:6629:6629` とポート公開していること。

### [4] user-api（オーケストレーション層）

FaceMask 側の入口。アーキテクチャ図（FaceMask/README.md）のオレンジ部分。ファイルの受付・ジョブキュー管理・結果の保管を担い、実際のAI処理は同じ Docker ネットワーク内の `mask-eyes`（目、port 6620）と `ocrmask`（文字列、port 6621）へ HTTP で委譲する。Vue が AI コンテナと直接話すことはない。

## 通信の中身（アプリケーションレベル）

非同期ジョブ方式。

1. `POST /file-processing-jobs`（multipart画像 + face_check/text_check等のクエリ）
   → 即座に `202` で `job_id` と `token`（Bearer）が返る（処理はまだ終わっていない）
2. `GET /file-processing-jobs/{job_id}?detail=hybrid` を約1.5秒間隔でポーリング
   → `status` が `completed` / `failed` / `cancelled` になるまで繰り返す
3. 完了レスポンス内の `files[].url` を使い、`Authorization` ヘッダーにトークンを添えて
   `GET /generated-files/{key}` → マスキング済み画像のバイナリを取得しプレビュー表示

注意（README「不正なファイルや一部失敗時の挙動」）: 目・文字列のどちらか一方でも失敗すると
マスキング画像自体が生成されない（`files[].url` が `null`、`error` に `face_failed`/`text_failed` 等）。

## 将来（コンテナ化後）

[2] が Vite（開発専用）から nginx に置き換わるだけで思想は同じ。

- Vue コンテナ内の nginx が「静的ファイル配信」と「`/api → user-api:6629` のリバースプロキシ」を兼ねる。
- 開発期間中（Flutter と並走・別compose）: `proxy_pass http://host.docker.internal:6629`
- FaceMask の compose に統合後: 同一 Docker ネットワークなので `proxy_pass http://user-api:6629`（[3]のWSL2中継も不要になる）
- ブラウザ側コードは一切変更不要 — 「接続先を知らない」設計にした狙い。
