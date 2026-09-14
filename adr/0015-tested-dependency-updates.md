# CIで確認したDependabotの更新をmajorも含めて自動マージする

- 日付: 2026-09-15
- 状態: 採用（運用開始は設定をmainへ取り込んだ後）

## 背景

依存更新PRの目視レビューが継続されないことを前提に、ロジックと最低限の画面操作を自動で検証して更新を取り込む。majorを一律に保留せず、同じ検証条件で扱う。現在の非公開リポジトリではGitHubのプラン制約でbranch protection/rulesetを利用できない。有料化や公開化はこの変更の対象にしない。

## 決定と理由

DependabotはnpmとGitHub Actionsを対象にする。更新頻度、リリース後の待機、同時PR数は[設定ファイル](../.github/dependabot.yml)で管理する。minor/patch/majorを自動マージの可否で区別しない。セキュリティ更新の作成可否はGitHub側の設定に従い、通常更新の待機期間・PR上限はセキュリティ更新には適用されない。

[CI](../.github/workflows/ci.yml)はPR先端を明示して取得し、lint・ブラウザ/Workersの型検査・全単体テスト・本番ビルド・Workerバンドル確認と、デスクトップ/モバイルのE2Eを行う。E2Eは本番ビルドした画面と実際のHonoルート/正規化を動かす。外部APIの取得層だけを固定データへ差し替え、背景地図は最小スタイル・空タイル、外部Webフォントはシステムフォントへ置き換える。実際のMapLibre/WebGLで価格を描き、描画ピクセルと操作結果を確認する。空のcanvasや表示フラグだけでは合格にしない。

価格一覧・年度/データ/指標の選択・地点詳細と推移・表示モード・地図上の価格選択・エラー再試行・空データ・画面からのはみ出しを検証する。外部サービスの可用性、地図ラベルやフォントの実配信、すべての地点の正しさをこのスモークテストで保証するものではない。実サービス向けの既存E2Eは残す。

CIのtokenは読み取り専用とし、checkoutの認証情報を残さない。`workflow_run`で動く[自動マージ](../.github/workflows/dependabot-automerge.yml)は既定ブランチのコードだけを取得し、npm install、PRコードの実行、PR成果物やキャッシュの読込を行わない。APIから取得した情報で次の条件を確かめ、未確認・不一致はマージしない。

- 作成者とCIの起点がDependabotであり、同一リポジトリのmain向けPRである。
- 対象は依存manifest/lockfile、または既存Workflow内の同一Actionの固定SHA更新だけである。npm scripts、テスト、実装、Workflowの処理変更を伴うPRは保留する。
- CIの実行ID・試行番号・ジョブ・必須ステップ・check suite・対象SHAが一致し、必要な処理がすべて成功している。追加チェックやcommit statusが未完了/失敗のときも保留する。
- PR先端に現在のmainが含まれ、競合がなく、変更要求レビューや`do-not-merge`ラベルがない。
- マージ直前にもPR先端、CI試行、mainを再取得する。APIには検証した先端SHAを渡し、squash mergeする。エラー時に対象を変えて再試行しない。

GitHub標準auto-mergeを有効化する方式は、利用できない必須チェック保護に依存するため採用しない。既存PRのマージ許可や本番デプロイはこの設定と別に扱う。今回の導入PRは手動で取り込むまで稼働しない。

## 制約と代替案

これは自動マージ処理の条件であり、リポジトリ全体の強制的なブランチ保護ではない。手動操作によるチェックの迂回を禁止できない。APIの`sha`はPR先端を固定するが、mainのSHAを同時に固定する機能ではない。直前確認後に別の操作でmainが進む微小な競合余地は残る。より強い統合時の保証が必要ならbranch protectionとmerge queueを利用できるプランへ移行する。

mainが進んで古くなったPRは、Dependabotがrebaseして新しいCIが通るまで保留する。バージョン更新にコード修正が必要なmajorも自動では修正しない。失敗したWorkflow/PRから調査し、必要なら手動で修正する。自動マージの設定自体を停止すれば運用を止められる。

固定のE2Eデータは外部サービス障害による失敗を減らす一方、実際のサービス仕様変更は検出できない。実API検証を必須CIにする案は、秘密情報・提供元の応答・アクセス制限への依存が強く、依存更新の検証と切り分けられないため採用しない。

## 見直す条件

新しい依存ecosystemを導入する、必須チェックやWorkflowを変更する、UI操作を変更する、固定データで再現できない回帰が出る、ブランチ保護を使えるようになったときに見直す。チェック名や許可する差分の実装は[判定コード](../.github/scripts/dependabot-automerge.mjs)と[拒否条件のテスト](../.github/scripts/dependabot-automerge.test.mjs)を併せて更新する。

## 関連

- [CI用E2E](../tests/e2e/smoke.spec.ts)、[固定データのサーバー](../tests/e2e/server.ts)
- [Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [workflow_runの権限と注意点](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [Pull request merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)
