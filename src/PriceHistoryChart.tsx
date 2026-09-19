import { useId, useState } from 'react'
import { type HistoryEntry, historySegments, historyStatusLabel } from './history'
import { changeLabel, priceLabel } from './metrics'
import { useHistoryChartAnimation } from './useHistoryChartAnimation'

interface Props {
  entries: HistoryEntry[]
  selectedYear: number
  loading: boolean
}

export function PriceHistoryChart({ entries, selectedYear, loading }: Props) {
  const [inspectedYear, setInspectedYear] = useState<number>()
  const titleId = useId()
  const plotClipId = useId()
  const values = entries.flatMap((entry) => (entry.point ? [entry.point.price] : []))
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const padding = Math.max((max - min) * 0.2, max * 0.025, 1)
  const { svg, low, high } = useHistoryChartAnimation(
    entries,
    loading,
    Math.max(0, min - padding),
    max + padding,
  )
  const start = entries[0]?.year ?? selectedYear
  const end = entries[entries.length - 1]?.year ?? selectedYear
  const x = (year: number) => 49 + ((year - start) / Math.max(1, end - start)) * 281
  const y = (price: number) => 145 - ((price - low) / (high - low)) * 121
  const current =
    entries.find((entry) => entry.year === inspectedYear) ??
    entries.find((entry) => entry.year === selectedYear)
  const step = Math.max(1, Math.ceil(entries.length / 6))

  return (
    <>
      <div className="history-readout" aria-live="polite">
        <span>
          {current?.year}年{current?.year === selectedYear ? ' · 地図の対象年' : ''}
          {current?.point?.source && ` · ${current.point.source === 'survey' ? 7 : 1}月1日時点`}
        </span>
        {current?.point ? (
          <strong>
            {priceLabel(current.point.price)} <small>万円 / ㎡</small>
            <span>前年比 {changeLabel(current.point.change)}</span>
          </strong>
        ) : (
          <strong className="history-no-value">
            {current ? historyStatusLabel[current.status] : 'データなし'}
          </strong>
        )}
      </div>
      <div className="history-plot" onPointerLeave={() => setInspectedYear(undefined)}>
        {values.length || loading ? (
          <>
            <svg
              ref={svg}
              className="history-chart"
              viewBox="0 0 348 177"
              aria-labelledby={titleId}
              role="img"
            >
              <title id={titleId}>
                {start}〜{end}年の価格推移。年ごとの数値は下の表でも確認できます。
              </title>
              <defs>
                <clipPath id={plotClipId}>
                  <rect x="43" y="19" width="293" height="132" />
                </clipPath>
              </defs>
              {entries.map((entry, i) => {
                if (entry.status !== 'loading') return undefined
                const left = i === 0 ? 49 : (x(entries[i - 1].year) + x(entry.year)) / 2
                const right =
                  i === entries.length - 1 ? 330 : (x(entry.year) + x(entries[i + 1].year)) / 2
                return (
                  <rect
                    key={entry.year}
                    className="history-loading-band"
                    data-year={entry.year}
                    x={left + 1}
                    y="24"
                    width={Math.max(0, right - left - 2)}
                    height="121"
                    rx="2"
                  />
                )
              })}
              {[low, (low + high) / 2, high].map((tick) => (
                <g key={tick}>
                  <line x1="49" x2="330" y1={y(tick)} y2={y(tick)} className="history-grid" />
                  {values.length > 0 && (
                    <text x="42" y={y(tick) + 4} textAnchor="end">
                      {priceLabel(tick)}
                    </text>
                  )}
                </g>
              ))}
              <text x="4" y="12">
                万円/㎡
              </text>
              {historySegments(entries).flatMap((segment) =>
                segment
                  .slice(1)
                  .map((entry, i) => (
                    <line
                      key={segment[i].year}
                      data-year={segment[i].year}
                      x1={x(segment[i].year)}
                      y1={y(segment[i].point?.price ?? 0)}
                      x2={x(entry.year)}
                      y2={y(entry.point?.price ?? 0)}
                      pathLength="1"
                      className="history-line"
                      clipPath={`url(#${plotClipId})`}
                    />
                  )),
              )}
              {entries.map((entry, i) => (
                <g key={entry.year}>
                  {entry.year === selectedYear && (
                    <line
                      x1={x(entry.year)}
                      x2={x(entry.year)}
                      y1="19"
                      y2="150"
                      className="history-selection"
                    />
                  )}
                  {entry.point && (
                    <circle
                      cx={x(entry.year)}
                      cy={y(entry.point.price)}
                      r={entry.year === current?.year ? 5 : 3}
                      className="history-dot"
                      data-year={entry.year}
                      clipPath={`url(#${plotClipId})`}
                    />
                  )}
                  {!entry.point && entry.status !== 'loading' && (
                    <text x={x(entry.year)} y="147" textAnchor="middle">
                      —
                    </text>
                  )}
                  {(i % step === 0 || i === entries.length - 1) && (
                    <text x={x(entry.year)} y="168" textAnchor="middle">
                      {entry.year}
                    </text>
                  )}
                </g>
              ))}
            </svg>
            {entries.map((entry) => (
              <button
                key={entry.year}
                type="button"
                className="history-hit"
                style={{
                  left: `${((x(entry.year) - Math.min(17, 140 / entries.length)) / 348) * 100}%`,
                  width: `${(Math.min(34, 280 / entries.length) / 348) * 100}%`,
                }}
                aria-label={`${entry.year}年：${entry.point ? `${priceLabel(entry.point.price)}万円/㎡、前年比${changeLabel(entry.point.change)}` : historyStatusLabel[entry.status]}`}
                onPointerEnter={() => setInspectedYear(entry.year)}
                onFocus={() => setInspectedYear(entry.year)}
                onClick={() => setInspectedYear(entry.year)}
              />
            ))}
          </>
        ) : (
          <p className="history-empty">この期間に表示できる価格データがありません。</p>
        )}
      </div>
      <details className="history-table">
        <summary>年ごとの数値を見る</summary>
        <table>
          <caption>価格の推移（万円/㎡）と前年比</caption>
          <thead>
            <tr>
              <th scope="col">年</th>
              <th scope="col">価格</th>
              <th scope="col">前年比</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.year} className={entry.year === selectedYear ? 'selected' : ''}>
                <th scope="row">
                  <button
                    type="button"
                    onFocus={() => setInspectedYear(entry.year)}
                    onClick={() => setInspectedYear(entry.year)}
                    aria-label={`${entry.year}年の値を確認`}
                  >
                    {entry.year}
                    {entry.point?.source && (
                      <small className="history-date">
                        {entry.point.source === 'survey' ? 7 : 1}月1日
                      </small>
                    )}
                    {entry.year === selectedYear && (
                      <span className="sr-only">（地図の対象年）</span>
                    )}
                  </button>
                </th>
                {entry.point ? (
                  <>
                    <td>{priceLabel(entry.point.price)}</td>
                    <td>{changeLabel(entry.point.change)}</td>
                  </>
                ) : (
                  <td colSpan={2}>{historyStatusLabel[entry.status]}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}
