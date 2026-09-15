# 実行環境が提供する環境変数読込と型生成を使う

- 日付: 2026-09-15
- 状態: 採用
- 関連: [ADR 0004](0004-cloudflare-deployment.md)

## 背景

ローカルNode.jsの環境変数読込だけにdotenvを、Workersの実行環境の型だけにworkers-typesを使っていた。Node.jsと、既に導入済みのWranglerが同じ用途を扱えるため、直接依存として別途更新する必要性が薄くなっている。

## 決定と理由

ローカルサーバーはNode.jsの`loadEnvFile`を使う。環境変数を外部から渡す起動方法も維持するため、`.env`がない場合は起動を妨げず、既存の環境変数をファイルの値で上書きしない。ファイル不存在以外の読込エラーは起動時に通知する。

Workersは`wrangler types`で環境変数と実行環境の型をまとめて生成し、Workers用TypeScript設定から参照する。compatibility dateとflagsに対応する型を生成できるため、常に最新の型を公開するworkers-typesとのずれを避けられる。型生成は既存のlint/build前処理で行い、生成ファイルを直接編集しない。ブラウザ用とWorkers用の型検査を分ける方針は維持する。

## 代替案とトレードオフ

従来の依存を残す方法でも動作するが、更新対象が増え、Workersの型と設定の対応を個別に管理する必要がある。生成型はWranglerを実行するまで存在しないので、クリーンチェックアウト後は`npm run cf:types`またはlint/buildが必要になる。ブラウザの描画機能やバンドルサイズを変えるための削減ではない。

## 見直す条件

サポートするNode.jsの範囲を変更する、複数の環境変数ファイルや独自の展開機能が必要になる、Workers共通ライブラリとして型を公開するときに見直す。

## 関連

- [環境変数読込](../server/environment.ts)、[検証](../tests/environment.test.ts)
- [型生成コマンド](../package.json)、[Workersの型設定](../tsconfig.worker.json)
- [Node.js loadEnvFile](https://nodejs.org/api/process.html#processloadenvfilepath)
- [Cloudflareの型生成への移行手順](https://developers.cloudflare.com/workers/languages/typescript/#migrating-from-cloudflareworkers-types-to-wrangler-types)
