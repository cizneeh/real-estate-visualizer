import { changeLabel, priceLabel } from './metrics'
import {
  MIN_COMPARISON_COUNT,
  TRANSACTION_COMPARISON_NOTE,
  type TransactionSummary,
  transactionComparisonLabel,
} from './transactionComparison'
import type { PricePoint } from './types'

function TransactionRecords({ records }: { records: PricePoint[] }) {
  return (
    <div className="transaction-records">
      {[...records]
        .sort((a, b) => (b.period ?? '').localeCompare(a.period ?? '') || b.price - a.price)
        .map((point, index) => (
          <details className="transaction-record" key={point.id}>
            <summary>
              <span>
                {index + 1}. {point.period ?? '取引時期不明'}
              </span>
              <strong>{priceLabel(point.price)}万円/㎡</strong>
            </summary>
            <dl>
              <dt>所在地（地区）</dt>
              <dd>{point.address || point.municipality || '—'}</dd>
              <dt>取引総額</dt>
              <dd>
                {point.totalPrice === undefined ? '—' : `${priceLabel(point.totalPrice, 0)}万円`}
              </dd>
              <dt>㎡単価</dt>
              <dd>{priceLabel(point.price)}万円/㎡</dd>
              <dt>{point.transactionType === 'condominium' ? '専有面積' : '土地面積'}</dt>
              <dd>{point.area === undefined ? '—' : `${point.area.toLocaleString('ja-JP')}㎡`}</dd>
              {point.usage && (
                <>
                  <dt>間取り</dt>
                  <dd>{point.usage}</dd>
                </>
              )}
              {point.zoning && (
                <>
                  <dt>用途地域</dt>
                  <dd>{point.zoning}</dd>
                </>
              )}
            </dl>
          </details>
        ))}
    </div>
  )
}

export function TransactionDetails({
  summary,
  year,
}: {
  summary: TransactionSummary
  year: number
}) {
  const showComparison = summary.status === 'ready' || summary.status === 'insufficient'
  return (
    <section className="transaction-details" aria-label="取引の情報">
      <div className="transaction-count">
        <h4>{year}年の取引件数</h4>
        <strong>{summary.records.length.toLocaleString()}件</strong>
      </div>
      <section
        className="transaction-comparison"
        aria-label="取引単価の前年比"
        aria-busy={summary.status === 'loading'}
      >
        <h4>
          取引単価の前年比 <strong>{changeLabel(summary.change)}</strong>
        </h4>
        {showComparison && (
          <>
            <p className="comparison-period">{transactionComparisonLabel(summary.period)}</p>
            <table>
              <caption className="sr-only">同じ期間の取引単価と件数</caption>
              <thead>
                <tr>
                  <th scope="col">対象年</th>
                  <th scope="col">㎡単価の中央値</th>
                  <th scope="col">件数</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { year, records: summary.current, median: summary.currentMedian },
                  { year: year - 1, records: summary.previous, median: summary.previousMedian },
                ].map((item) => (
                  <tr key={item.year}>
                    <th scope="row">{item.year}年</th>
                    <td>{item.median === undefined ? '—' : `${priceLabel(item.median)}万円`}</td>
                    <td>{item.records.length}件</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className="comparison-status" aria-live="polite">
          {summary.status === 'loading'
            ? '比較する取引を取得中…'
            : summary.status === 'error'
              ? 'データの取得に失敗したため比較できません。画面下の「再試行」で取得し直せます。'
              : summary.status === 'earliest'
                ? '前年はデータの提供開始前のため、比較できません。'
                : summary.status === 'no-period'
                  ? '比較できる期間の取引データがありません。'
                  : summary.status === 'insufficient'
                    ? `件数不足：比較期間の取引が両年とも${MIN_COMPARISON_COUNT}件以上ある場合に前年比を表示します。`
                    : `両年とも${MIN_COMPARISON_COUNT}件以上の取引で計算していますが、件数が少ないほど個々の取引の影響を受けやすくなります。`}
        </p>
        {showComparison && (
          <p className="comparison-note">
            表示範囲で取得できた{year}年の最新四半期まで、前年も同じ月にそろえて比較しています。
          </p>
        )}
        {showComparison && summary.excludedCount > 0 && (
          <p className="comparison-note">
            取引時期を確認できない{summary.excludedCount}件は比較対象外です。
          </p>
        )}
        <p className="comparison-note">{TRANSACTION_COMPARISON_NOTE}</p>
      </section>
      <h4 className="transaction-list-heading">{year}年の各取引</h4>
      <TransactionRecords records={summary.records} />
      {showComparison && summary.previous.length > 0 && (
        <details className="previous-transactions">
          <summary>
            比較に使った{year - 1}年の取引（{summary.previous.length}件）
          </summary>
          <TransactionRecords records={summary.previous} />
        </details>
      )}
    </section>
  )
}
