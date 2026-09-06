# 現行の地図をCloudflare Workersで公開する

- 日付: 2026-09-06
- 状態: 採用
- 関連: [ADR 0001](0001-tile-loading-and-cache.md)、[ADR 0002](0002-request-scheduling-and-prefetch.md)の公開環境での保存先・取得制御を一部置換

## 背景

まずmainのアプリを独自ドメインで公開する。D1に価格データを取り込んで閲覧と更新を分離する方針は別の作業として扱い、初回公開には含めない。

既存のAPIはNode.jsのプロセス内で取得中のPromiseやタイマーを共有し、ファイルキャッシュを利用する。Workersではローカルディスクを永続保存先にできず、別のリクエストが開始したI/Oを共有する実装もそのまま移植できない。

## 決定と理由

- Viteでビルドした画面をWorkers Static Assetsで配信し、同じドメインの`/api/*`をHonoで処理する。画面と価格データの正規化は共通にし、Workers用のエントリーポイントと取得アダプターを追加する。
- 国交省APIキーはWorkersのSecretに置く。公開APIは同じオリジンから利用できるようにする。オリジンの検査は利用者認証ではなく、API自体は公開する。
- 公開環境のタイルはWorkers Cache APIで一時的に保持する。キーにデータ種別・年・座標を含む取得URLを使い、認証情報を含めない。空のタイルも保存し、失敗した応答は保存しない。ローカルNode.jsのファイルキャッシュは引き続き利用できる。
- WorkersではリクエストごとにI/Oを生成し、取得中のPromise・Response・タイマーを別のリクエストに渡さない。同一isolate内で共有するのは取得数・開始時刻・エラー後の待機期限などの数値だけとし、並列数・開始間隔・先読みの優先順位を制御する。
- API用とブラウザ用のTypeScript設定を分け、Wranglerで生成する環境変数の型を使う。本番公開はmainへ取り込まれたコミットを対象にする。

## トレードオフと代替案

Cache APIの保存はデータセンターごとであり、永続DBや全世界で共有されるキャッシュではない。isolateをまたぐ取得数や同一タイルの重複取得も統一して制御しない。Workers内でPromiseを共有してNode.jsの処理をそのまま再現する方法は、I/Oの所有関係を壊すため採用しない。

共通の取得制御にDurable Objectsを追加することや、D1への永続保存を同時に実装することもできるが、今回は現行機能の公開を優先する。外部APIへのブラウザからの制限付き並列取得・先読みと、APIエラー後の待機は継続する。

## 見直す条件

D1への保存を実装するときに、キャッシュミスによる外部APIへの取得を独立した取り込み処理へ移す。複数拠点からの取得によるアクセス制限が発生する場合は、外部APIキー単位での共通取得制御を検討する。

## 関連する実装・仕様

- [公開設定](../wrangler.jsonc)、[Worker](../server/worker.ts)
- [Workersの取得とキャッシュ](../server/edgeTileStore.ts)、[検証](../tests/edge.test.ts)
- [Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [WorkersのリクエストをまたぐI/Oの制約](https://developers.cloudflare.com/workers/observability/errors/)
