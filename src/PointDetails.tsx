import { ArrowDownRight, ArrowUpRight, ChevronDown, LoaderCircle, X } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { historyStatusLabel, historyYears, periodLabel } from './history'
import { changeLabel, priceLabel } from './metrics'
import { PriceHistoryChart } from './PriceHistoryChart'
import type { createTileQueries } from './tileQueries'
import type { Dataset, PricePoint } from './types'
import { usePointHistory } from './usePointHistory'

export interface PointSelection {
  point: PricePoint
  year: number
}

interface Props {
  selection: PointSelection
  dataset: Dataset
  year: number
  currentPoint?: PricePoint
  loading: boolean
  requests: ReturnType<typeof createTileQueries>
  onClose: () => void
}

export function PointDetails({
  selection,
  dataset,
  year,
  currentPoint,
  loading,
  requests,
  onClose,
}: Props) {
  const scroller = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const [canScrollDown, setCanScrollDown] = useState(false)
  const updateScroll = useCallback(() => {
    const element = scroller.current
    if (!element) return
    setCanScrollDown(element.scrollHeight - element.clientHeight - element.scrollTop > 2)
  }, [])

  useLayoutEffect(() => {
    const observer = new ResizeObserver(updateScroll)
    if (scroller.current) observer.observe(scroller.current)
    if (content.current) observer.observe(content.current)
    updateScroll()
    return () => observer.disconnect()
  }, [updateScroll])

  const [span, setSpan] = useState<number | 'all'>(5)
  const years = historyYears(dataset, year, span)
  const history = usePointHistory(selection.point, dataset, years, requests)
  const entry = history.entries.find((item) => item.year === year)
  const point =
    dataset === 'transactions'
      ? currentPoint
      : history.supported
        ? entry?.point
        : year === selection.year
          ? selection.point
          : undefined
  const identity = point ?? selection.point
  const pending = dataset === 'transactions' ? loading : entry?.status === 'loading'

  return (
    <aside className="detail-panel" aria-label="地点の詳細">
      <div className="detail-heading">
        <span className="detail-category">{identity.category}</span>
        <button type="button" className="icon-button" aria-label="詳細を閉じる" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <section
        className="detail-scroll"
        ref={scroller}
        onScroll={updateScroll}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to focus this region to scroll its details.
        tabIndex={0}
        aria-label="地点の詳細情報"
      >
        <div className="detail-content" ref={content}>
          <h3>{identity.address}</h3>
          <p className="detail-town">{identity.municipality}</p>
          <p className="detail-period">{periodLabel(dataset, 'price', year)}</p>
          {point ? (
            <>
              <div className="detail-price">
                {priceLabel(point.price)}
                <small>万円 / ㎡</small>
              </div>
              {dataset !== 'transactions' && (
                <div className="detail-change">
                  {point.change !== undefined &&
                    (point.change >= 0 ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />)}
                  前年比 {changeLabel(point.change)}
                  <span>
                    （{year - 1} → {year}年）
                  </span>
                </div>
              )}
            </>
          ) : (
            <p className="detail-unavailable" aria-live="polite">
              {pending ? (
                <>
                  <LoaderCircle size={15} className="spin" /> {year}年の価格を取得中…
                </>
              ) : (
                `${year}年：${entry ? historyStatusLabel[entry.status] : 'データなし'}`
              )}
            </p>
          )}
          {dataset !== 'transactions' && (
            <section className="price-history" aria-label="価格の推移" aria-busy={history.loading}>
              <div className="history-heading">
                <h4>価格の推移</h4>
                <span>
                  {years[0]}〜{year}年
                </span>
              </div>
              {history.supported ? (
                <>
                  <fieldset className="history-range" aria-label="推移の表示期間">
                    {(
                      [
                        { value: 5, label: '5年前から' },
                        { value: 10, label: '10年前から' },
                        { value: 'all', label: '全期間' },
                      ] as const
                    ).map(({ value, label }) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={span === value}
                        className={span === value ? 'active' : ''}
                        onClick={() => setSpan(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </fieldset>
                  <PriceHistoryChart
                    key={`${year}-${span}`}
                    entries={history.entries}
                    selectedYear={year}
                  />
                  {history.loading && (
                    <p className="history-progress">
                      <LoaderCircle size={13} className="spin" /> 各年の価格を取得中…
                    </p>
                  )}
                  {history.failed && (
                    <div className="history-error" role="alert">
                      一部の年を取得できませんでした。
                      <button type="button" disabled={history.loading} onClick={history.retry}>
                        履歴を再試行
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="history-note">
                  地点を継続して識別できる情報がないため、推移を表示できません。
                </p>
              )}
            </section>
          )}
          {point && (
            <details className="point-attributes">
              <summary>地点の情報</summary>
              <dl>
                {point.count !== undefined && (
                  <>
                    <dt>取引件数</dt>
                    <dd>{point.count}件</dd>
                  </>
                )}
                {point.station && (
                  <>
                    <dt>最寄り駅</dt>
                    <dd>{point.station}</dd>
                  </>
                )}
                {point.stationDistance && (
                  <>
                    <dt>駅までの道路距離</dt>
                    <dd>{point.stationDistance}</dd>
                  </>
                )}
                {point.area !== undefined && (
                  <>
                    <dt>地積</dt>
                    <dd>{point.area.toLocaleString()}㎡</dd>
                  </>
                )}
                {point.zoning && (
                  <>
                    <dt>用途地域</dt>
                    <dd>{point.zoning}</dd>
                  </>
                )}
                {point.usage && (
                  <>
                    <dt>利用現況</dt>
                    <dd>{point.usage}</dd>
                  </>
                )}
                {point.previousPrice !== undefined && (
                  <>
                    <dt>{year - 1}年の価格</dt>
                    <dd>{priceLabel(point.previousPrice)}万円/㎡</dd>
                  </>
                )}
              </dl>
            </details>
          )}
          {dataset === 'transactions' && (
            <p className="detail-note">
              {year}年の取引価格（㎡単価）の中央値。物件の所在地を示すものではありません。
            </p>
          )}
        </div>
      </section>
      {canScrollDown && (
        <button
          type="button"
          className="detail-scroll-hint"
          onClick={() => {
            const element = scroller.current
            if (!element) return
            element.scrollBy({
              top: element.clientHeight * 0.7,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'instant'
                : 'smooth',
            })
          }}
        >
          下にスクロールで続き <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    </aside>
  )
}
