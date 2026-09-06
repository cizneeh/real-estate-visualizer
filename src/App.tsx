import {
  ArrowDownRight,
  ArrowUpRight,
  Box,
  Building2,
  Check,
  ChevronRight,
  Compass,
  ExternalLink,
  Globe2,
  Info,
  Layers3,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Minus,
  MoveUpRight,
  Pause,
  Play,
  Plus,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react'
import type { Map as LibreMap } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapCanvas } from './MapCanvas'
import {
  CHANGE_COLORS,
  changeLabel,
  colorFor,
  groupTransactions,
  median,
  PRICE_COLORS,
  priceLabel,
} from './metrics'
import { type Bounds, type Dataset, JAPAN_BOUNDS, type PricePoint, type ViewMode } from './types'
import { useCurrentLocation } from './useCurrentLocation'
import { useMapTools } from './useMapTools'
import { usePriceTiles } from './usePriceTiles'

const DATASETS: { id: Dataset; name: string; description: string; icon: typeof MapPin }[] = [
  { id: 'land', name: '公示地価', description: '1月1日時点の土地の価格', icon: Layers3 },
  { id: 'survey', name: '基準地価', description: '7月1日時点の土地の価格', icon: MapPin },
  { id: 'change', name: '地価の変化', description: '公示地価の前年比', icon: TrendingUp },
  {
    id: 'transactions',
    name: 'マンション取引',
    description: '中古マンション等の実取引',
    icon: Building2,
  },
]
const EMPTY_POINTS: PricePoint[] = []
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026]

export function App() {
  const [dataset, setDataset] = useState<Dataset>('land')
  const [year, setYear] = useState(2025)
  const [mode, setMode] = useState<ViewMode>('3d')
  const [category, setCategory] = useState('すべて')
  const [bounds, setBounds] = useState<Bounds>()
  const { data, loading, error, completed, retry } = usePriceTiles(bounds, dataset, year)
  const [map, setMap] = useState<LibreMap>()
  const [mapRendered, setMapRendered] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [playing, setPlaying] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const infoDialog = useRef<HTMLDialogElement>(null)
  const { position, locating, error: locationError, locate } = useCurrentLocation()
  const activeDataset = DATASETS.find((item) => item.id === dataset) ?? DATASETS[0]
  const handleBounds = useCallback((next: Bounds) => setBounds(next), [])
  const handleSelect = useCallback((point: PricePoint) => setSelectedId(point.id), [])
  const handleReady = useCallback((next: LibreMap) => setMap(next), [])
  const handleRendered = useCallback((ready: boolean) => setMapRendered(ready), [])

  useEffect(() => {
    if (!position) return
    setSelectedId(undefined)
  }, [position])

  useEffect(() => {
    if (error) setPlaying(false)
  }, [error])

  useEffect(() => {
    if (!playing || loading || !mapRendered || error) return
    const timer = window.setTimeout(
      () => setYear((value) => (value >= 2026 ? 2020 : value + 1)),
      2400,
    )
    return () => window.clearTimeout(timer)
  }, [playing, loading, mapRendered, error])

  const currentData = data?.dataset === dataset && data.year === year ? data : undefined
  const rawPoints = currentData?.points ?? EMPTY_POINTS
  const points = useMemo(() => {
    if (dataset === 'transactions') return groupTransactions(rawPoints)
    return rawPoints.filter(
      (point) =>
        (category === 'すべて' || point.category === category) &&
        (dataset !== 'change' || point.change !== undefined),
    )
  }, [rawPoints, dataset, category])
  const selected = points.find((point) => point.id === selectedId)
  useMapTools({ dataset, year, bounds, loading, error, points })
  const midpoint = median(points.map((point) => point.price))
  const medianChange = median(
    points.flatMap((point) => (point.change === undefined ? [] : [point.change])),
  )
  const ranking = useMemo(
    () =>
      [...points]
        .sort((a, b) =>
          dataset === 'change' ? (b.change ?? 0) - (a.change ?? 0) : b.price - a.price,
        )
        .slice(0, 5),
    [points, dataset],
  )
  const metric = (point: PricePoint) =>
    dataset === 'change' ? changeLabel(point.change) : priceLabel(point.price)

  function changeDataset(next: Dataset) {
    setDataset(next)
    setSelectedId(undefined)
    setPlaying(false)
    if (next === 'change' && mode === 'heatmap') setMode('points')
  }

  function showJapan() {
    setSelectedId(undefined)
    setSidebarOpen(false)
    map?.fitBounds(JAPAN_BOUNDS, { padding: 40, pitch: 0, bearing: 0, duration: 1200 })
  }

  function focusPoint(point: PricePoint) {
    setSelectedId(point.id)
    map?.easeTo({ center: point.coordinates, duration: 800 })
  }

  return (
    <main className="atlas">
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <header className="brand">
          <div className="brand-mark">
            <Layers3 size={24} strokeWidth={1.5} />
          </div>
          <h1>街の値段</h1>
          <button
            className="icon-button mobile-close"
            type="button"
            aria-label="パネルを閉じる"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </header>

        <div className="sidebar-content">
          <section className="dataset-section" aria-labelledby="dataset-title">
            <div className="section-heading">
              <h3 id="dataset-title">表示するデータ</h3>
              <span>01 — 04</span>
            </div>
            <div className="dataset-list">
              {DATASETS.map(({ id, name, description, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`dataset-button ${dataset === id ? 'active' : ''}`}
                  aria-pressed={dataset === id}
                  onClick={() => changeDataset(id)}
                >
                  <Icon size={20} strokeWidth={1.6} />
                  <span>
                    <strong>{name}</strong>
                    <small>{description}</small>
                  </span>
                  {dataset === id ? (
                    <span className="selected-check">
                      <Check size={12} />
                    </span>
                  ) : (
                    <ChevronRight size={15} />
                  )}
                </button>
              ))}
            </div>
          </section>

          {dataset !== 'transactions' && (
            <section className="category-section" aria-labelledby="category-title">
              <div className="section-heading">
                <h3 id="category-title">土地の用途</h3>
                <SlidersHorizontal size={14} />
              </div>
              <div className="segmented category-controls">
                {['すべて', '住宅地', '商業地'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={category === value}
                    className={category === value ? 'active' : ''}
                    onClick={() => {
                      setCategory(value)
                      setSelectedId(undefined)
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section
            className={`area-summary ${loading ? 'is-loading' : ''}`}
            aria-labelledby="summary-title"
          >
            <div className="section-heading">
              <h3 id="summary-title">
                {dataset === 'transactions' ? '駅別中央値の中央値' : '表示範囲の中央値'}
              </h3>
              <span>
                {loading
                  ? `${points.length.toLocaleString()}地点・取得途中`
                  : `${points.length.toLocaleString()}地点`}
              </span>
            </div>
            <div className="big-metric">
              {dataset === 'change' ? changeLabel(medianChange) : priceLabel(midpoint)}
              {dataset !== 'change' && <small>万円 / ㎡</small>}
            </div>
            <div className="summary-foot">
              {dataset === 'transactions' ? (
                <>
                  <Building2 size={14} /> {rawPoints.length.toLocaleString()}
                  件の取引を駅の位置で集計
                </>
              ) : (
                <>
                  <TrendingUp size={14} />
                  <span>
                    前年比 <strong>{changeLabel(medianChange)}</strong>
                  </span>
                </>
              )}
            </div>
          </section>

          <section className="ranking" aria-labelledby="ranking-title">
            <div className="section-heading">
              <h3 id="ranking-title">
                {dataset === 'change' ? '上昇率の高い地点' : '価格の高い地点'}
              </h3>
              <span>IN VIEW</span>
            </div>
            {ranking.length ? (
              ranking.map((point, i) => (
                <button
                  type="button"
                  className="rank-row"
                  key={point.id}
                  onClick={() => focusPoint(point)}
                >
                  <span className="rank-number">0{i + 1}</span>
                  <span className="rank-label">
                    <strong>{point.address || point.municipality}</strong>
                    <small>{point.station ? `${point.station}駅周辺` : point.category}</small>
                  </span>
                  <span className="rank-value">
                    {metric(point)}
                    <ArrowUpRight size={13} />
                  </span>
                </button>
              ))
            ) : (
              <p className="empty-ranking">
                {loading
                  ? '地図の範囲からデータを取得しています'
                  : currentData?.zoomRequired
                    ? '見たい地域を拡大してください'
                    : 'この範囲には対象地点がありません'}
              </p>
            )}
          </section>
        </div>
        <footer className="sidebar-footer">
          <button type="button" onClick={() => infoDialog.current?.showModal()}>
            <Info size={15} />
            データ・表示について
            <ExternalLink size={13} />
          </button>
          <span>出典：国土交通省 不動産情報ライブラリ</span>
        </footer>
      </aside>

      <section className="map-workspace" aria-label="マップで探索">
        <MapCanvas
          points={points}
          dataset={dataset}
          mode={mode}
          position={position}
          onBounds={handleBounds}
          onSelect={handleSelect}
          onReady={handleReady}
          onRendered={handleRendered}
        />
        <div className="map-vignette" />
        <div className="map-topbar">
          <div className="location-control">
            <button
              type="button"
              className="icon-button mobile-menu"
              aria-label="データパネルを開く"
              onClick={() => setSidebarOpen(true)}
            >
              <SlidersHorizontal size={18} />
            </button>
            <MapPin size={16} />
            <span>全国の不動産価格</span>
            <span className="location-divider" />
            <span className="location-meta">{year}</span>
          </div>
        </div>

        <div className="map-heading">
          <h2>{activeDataset.name}</h2>
          <p>
            {year}年<span> / </span>
            {dataset === 'transactions' ? '最寄り駅の位置に集約' : category}
          </p>
          {(locating || locationError) && (
            <div className="location-notice" aria-live="polite">
              {locating ? <LoaderCircle size={14} className="spin" /> : <Info size={14} />}
              <span>{locating ? '現在地を取得中…' : locationError}</span>
            </div>
          )}
        </div>

        <div className="map-tools">
          <fieldset className="mode-control" aria-label="表示方法">
            {(
              [
                { id: '3d', label: '3D', icon: Box },
                { id: 'points', label: 'ポイント', icon: MapPin },
                { id: 'heatmap', label: 'ヒート', icon: Sparkles },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                title={
                  id === 'heatmap' && dataset === 'change'
                    ? '前年比は3Dまたはポイントで表示します'
                    : `${label}表示`
                }
                disabled={id === 'heatmap' && dataset === 'change'}
                aria-pressed={mode === id}
                className={mode === id ? 'active' : ''}
                onClick={() => setMode(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </fieldset>
          <div className="zoom-controls">
            <button type="button" aria-label="ズームイン" onClick={() => map?.zoomIn()}>
              <Plus size={19} />
            </button>
            <button type="button" aria-label="ズームアウト" onClick={() => map?.zoomOut()}>
              <Minus size={19} />
            </button>
            <button
              type="button"
              aria-label="北を上にする"
              onClick={() => map?.easeTo({ bearing: 0, duration: 500 })}
            >
              <Compass size={19} />
            </button>
            <button
              type="button"
              aria-label="現在地に戻る"
              title="現在地に戻る"
              disabled={locating}
              onClick={locate}
            >
              {locating ? <LoaderCircle size={17} className="spin" /> : <LocateFixed size={17} />}
            </button>
            <button type="button" aria-label="全国を表示" title="全国を表示" onClick={showJapan}>
              <Globe2 size={17} />
            </button>
          </div>
        </div>

        {selected && (
          <aside className="detail-panel" aria-label="地点の詳細">
            <div className="detail-heading">
              <span className="eyebrow">
                {dataset === 'transactions' ? 'STATION AREA' : 'SELECTED POINT'}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="詳細を閉じる"
                onClick={() => setSelectedId(undefined)}
              >
                <X size={18} />
              </button>
            </div>
            <span className="detail-category">{selected.category}</span>
            <h3>{selected.address}</h3>
            <p className="detail-town">{selected.municipality}</p>
            <div className="detail-price" style={{ color: colorFor(selected, dataset) }}>
              {priceLabel(selected.price)}
              <small>万円 / ㎡</small>
            </div>
            {selected.change !== undefined && (
              <div className="detail-change">
                {selected.change >= 0 ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
                前年比 {changeLabel(selected.change)}
              </div>
            )}
            <dl>
              {selected.count !== undefined && (
                <>
                  <dt>取引件数</dt>
                  <dd>{selected.count}件</dd>
                </>
              )}
              {selected.station && (
                <>
                  <dt>最寄り駅</dt>
                  <dd>{selected.station}</dd>
                </>
              )}
              {selected.stationDistance && (
                <>
                  <dt>駅までの道路距離</dt>
                  <dd>{selected.stationDistance}</dd>
                </>
              )}
              {selected.area !== undefined && (
                <>
                  <dt>地積</dt>
                  <dd>{selected.area.toLocaleString()}㎡</dd>
                </>
              )}
              {selected.zoning && (
                <>
                  <dt>用途地域</dt>
                  <dd>{selected.zoning}</dd>
                </>
              )}
              {selected.usage && (
                <>
                  <dt>利用現況</dt>
                  <dd>{selected.usage}</dd>
                </>
              )}
              {selected.previousPrice ? (
                <>
                  <dt>前年の価格</dt>
                  <dd>{priceLabel(selected.previousPrice)}万円/㎡</dd>
                </>
              ) : undefined}
            </dl>
            <p className="detail-note">
              {selected.period ?? `${year}年の取引価格（㎡単価）の中央値`}
              {dataset === 'transactions' && (
                <>
                  <br />
                  物件の所在地を示すものではありません。
                </>
              )}
            </p>
          </aside>
        )}

        <div className="map-bottom">
          <div className="legend">
            <div className="legend-title">
              <span>
                {dataset === 'change'
                  ? '対前年変動率'
                  : mode === 'heatmap'
                    ? '価格で重み付けした密度'
                    : '㎡あたりの価格'}
              </span>
              <small>
                {mode === 'heatmap' ? '相対値' : dataset === 'change' ? '%' : '万円 / ㎡'}
              </small>
            </div>
            <div
              className="legend-gradient"
              style={{
                background: `linear-gradient(90deg, ${(dataset === 'change' ? CHANGE_COLORS : PRICE_COLORS).join(',')})`,
              }}
            />
            <div className="legend-labels">
              {(mode === 'heatmap'
                ? ['低い', '高い']
                : dataset === 'change'
                  ? ['−5', '0', '2', '5', '10', '20+']
                  : ['0', '30', '70', '150', '500', '1,500+']
              ).map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            {mode === '3d' && (
              <p>
                {dataset === 'change'
                  ? '高さは変動率の絶対値、色は増減を表します'
                  : '高さは価格の平方根に比例（上限6,500m）'}
              </p>
            )}
          </div>
          <div
            className="data-status"
            role="status"
            data-completed={completed}
            data-total={data.tiles}
            data-loading={loading}
          >
            {loading || (!mapRendered && !error) ? (
              <>
                <LoaderCircle size={14} className="spin" />
                <span>
                  {loading
                    ? `国交省のデータを取得中…${data.tiles ? ` ${Math.round((completed / data.tiles) * 100)}%` : ''}${points.length ? ` / ${points.length.toLocaleString()}地点を表示中（集計途中）` : ''}`
                    : '地図を描画中…'}
                </span>
              </>
            ) : error ? (
              <>
                <span className="status-dot error" />
                <span>{error}</span>
                <button type="button" onClick={retry}>
                  再試行
                </button>
              </>
            ) : currentData?.message ? (
              <>
                <Info size={14} />
                <span>{currentData.message}</span>
                {!currentData.zoomRequired && (
                  <button type="button" onClick={retry}>
                    再試行
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="status-dot" />
                <span>
                  {points.length
                    ? `${points.length.toLocaleString()}地点を表示中`
                    : 'この範囲・年度には対象データがありません'}
                  {dataset === 'transactions' && ` / ${rawPoints.length.toLocaleString()}件`}
                </span>
              </>
            )}
          </div>
          <div className="timeline">
            <div className="timeline-label">
              <span>観測年</span>
              <strong>
                {year}
                <small>年</small>
              </strong>
            </div>
            <button
              type="button"
              className={`play-button ${playing ? 'playing' : ''}`}
              aria-label={playing ? '年度の自動再生を停止' : '年度を自動再生'}
              aria-pressed={playing}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? (
                <Pause size={16} fill="currentColor" />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
            </button>
            <div className="year-selector">
              {YEARS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value}年を表示`}
                  aria-pressed={year === value}
                  className={year === value ? 'active' : ''}
                  onClick={() => {
                    setPlaying(false)
                    setYear(value)
                  }}
                >
                  <span className="year-tick" />
                  <span>{value}</span>
                </button>
              ))}
            </div>
            <div className="timeline-source">
              <span>国土交通省</span>
              <span>
                不動産情報ライブラリ
                <MoveUpRight size={12} />
              </span>
            </div>
          </div>
        </div>
      </section>

      <dialog className="info-dialog" ref={infoDialog}>
        <div className="dialog-heading">
          <h2>データ・表示について</h2>
          <form method="dialog">
            <button className="icon-button" type="submit" aria-label="説明を閉じる">
              <X size={20} />
            </button>
          </form>
        </div>
        <p>
          国土交通省「不動産情報ライブラリ」の実データを、全国で表示しています。地図の移動や年度の変更に合わせて取得します。広域表示では、見たい地域を拡大してください。
        </p>
        <p>
          最初に東京駅周辺を表示し、位置情報を取得できた場合は現在地の周辺へ移動します。取得待ちや取得できない場合も東京周辺から探索できます。現在地ボタンで再取得でき、位置情報は保存しません。
        </p>
        <h3>価格の読み方</h3>
        <p>
          公示地価は1月1日、基準地価は7月1日時点の土地1㎡あたりの価格です。マンション取引は土地の価格とは異なるため、直接比較できません。公表前の年度や対象地点のない範囲は空になります。
        </p>
        <p>
          マンション取引は中古マンション等の取引価格情報を使用します。各取引の総額を面積で割り、同じ最寄り駅の座標ごとに中央値を算出しています。面積が「以上」等で表された取引は計算から除きます。地点の高さや地図上の位置は、建物の高さや物件所在地を表しません。
        </p>
        <h3>集計と可視化</h3>
        <p>
          集計は表示範囲内の取得済み地点が対象です。地域全体の市場相場を推計するものではありません。ヒートマップは価格を重みにした密度で、地点数の影響も受けます。3Dの高さは価格差を見やすく圧縮し、前年比では変動率の絶対値を使っています。
        </p>
        <p className="official-notice">
          このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません。
        </p>
        <a href="https://www.reinfolib.mlit.go.jp/help/apiManual/" target="_blank" rel="noreferrer">
          データの出典とAPI仕様 <ExternalLink size={14} />
        </a>
        <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
          背景地図：OpenFreeMap / OpenStreetMap <ExternalLink size={14} />
        </a>
      </dialog>
    </main>
  )
}
