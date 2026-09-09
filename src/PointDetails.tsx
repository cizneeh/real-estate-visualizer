import { ArrowDownRight, ArrowUpRight, ChevronDown, X } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { changeLabel, colorFor, priceLabel } from './metrics'
import type { Dataset, PricePoint } from './types'

interface Props {
  point: PricePoint
  dataset: Dataset
  year: number
  onClose: () => void
}

export function PointDetails({ point, dataset, year, onClose }: Props) {
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

  return (
    <aside className="detail-panel" aria-label="地点の詳細">
      <div className="detail-heading">
        <span className="detail-category">{point.category}</span>
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
          <h3>{point.address}</h3>
          <p className="detail-town">{point.municipality}</p>
          <div className="detail-metrics">
            <div className="detail-price" style={{ color: colorFor(point, dataset) }}>
              {priceLabel(point.price)}
              <small>万円 / ㎡</small>
            </div>
            {point.change !== undefined && (
              <div className="detail-change">
                {point.change >= 0 ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
                前年比 {changeLabel(point.change)}
              </div>
            )}
          </div>
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
            {point.previousPrice ? (
              <>
                <dt>前年の価格</dt>
                <dd>{priceLabel(point.previousPrice)}万円/㎡</dd>
              </>
            ) : undefined}
          </dl>
          <p className="detail-note">
            {point.period ?? `${year}年の取引価格（㎡単価）の中央値`}
            {dataset === 'transactions' && (
              <>
                <br />
                物件の所在地を示すものではありません。
              </>
            )}
          </p>
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
