import {
  ArrowUpRight,
  Box,
  Building2,
  Check,
  ChevronDown,
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
  Pause,
  Play,
  Plus,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
  ZoomIn,
} from 'lucide-react'
import type { Map as LibreMap } from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AddressSearch } from './AddressSearch'
import { matchHistoryPoint, periodLabel } from './history'
import { MapCanvas } from './MapCanvas'
import {
  CHANGE_COLORS,
  changeLabel,
  groupTransactions,
  median,
  PRICE_COLORS,
  priceLabel,
} from './metrics'
import { PointDetails, type PointSelection } from './PointDetails'
import {
  type Bounds,
  type Dataset,
  JAPAN_BOUNDS,
  type Metric,
  type PricePoint,
  type ViewMode,
} from './types'
import { useAddressSearch } from './useAddressSearch'
import { useCurrentLocation } from './useCurrentLocation'
import { useMapTools } from './useMapTools'
import { usePriceTiles } from './usePriceTiles'
import { FIRST_YEAR, LAST_YEAR, yearsForDataset } from './years'

const DATASETS: { id: Dataset; name: string; description: string; icon: typeof MapPin }[] = [
  { id: 'land', name: '公示地価', description: '1月1日時点の土地の価格', icon: Layers3 },
  { id: 'survey', name: '基準地価', description: '7月1日時点の土地の価格', icon: MapPin },
  {
    id: 'transactions',
    name: 'マンション取引',
    description: '中古マンション等の実取引',
    icon: Building2,
  },
]
const EMPTY_POINTS: PricePoint[] = []

export function App() {
  const [dataset, setDataset] = useState<Dataset>('land')
  const [metric, setMetric] = useState<Metric>('price')
  const [year, setYear] = useState(2025)
  const [mode, setMode] = useState<ViewMode>('3d')
  const [category, setCategory] = useState('すべて')
  const [bounds, setBounds] = useState<Bounds>()
  const { data, loading, error, completed, retry, requests } = usePriceTiles(bounds, dataset, year)
  const [map, setMap] = useState<LibreMap>()
  const [mapRendered, setMapRendered] = useState(false)
  const [selection, setSelection] = useState<PointSelection>()
  const [playing, setPlaying] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const yearSelector = useRef<HTMLDivElement>(null)
  const years = useMemo(() => yearsForDataset(dataset), [dataset])
  const [legendOpen, setLegendOpen] = useState(false)
  const infoDialog = useRef<HTMLDialogElement>(null)
  const {
    position,
    locating,
    error: locationError,
    locate,
    cancel: cancelLocation,
  } = useCurrentLocation()
  const addressSearch = useAddressSearch()
  const handleBounds = useCallback((next: Bounds) => setBounds(next), [])
  const handleSelect = useCallback(
    (point: PricePoint) => {
      setSelection({ point, year })
      setPlaying(false)
    },
    [year],
  )
  const handleReady = useCallback((next: LibreMap) => setMap(next), [])
  const handleRendered = useCallback((ready: boolean) => setMapRendered(ready), [])

  useEffect(() => {
    if (!position) return
    setSelection(undefined)
  }, [position])

  useEffect(() => {
    if (!addressSearch.result) return
    setSelection(undefined)
    setPlaying(false)
  }, [addressSearch.result])

  useEffect(() => {
    if (error) setPlaying(false)
  }, [error])

  useEffect(() => {
    yearSelector.current?.children
      .item(years.indexOf(year))
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [year, years])

  useEffect(() => {
    if (!playing || loading || !mapRendered || error) return
    const timer = window.setTimeout(
      () => setYear(year >= LAST_YEAR ? FIRST_YEAR[dataset] : year + 1),
      2400,
    )
    return () => window.clearTimeout(timer)
  }, [playing, loading, mapRendered, error, dataset, year])

  const currentData = data?.dataset === dataset && data.year === year ? data : undefined
  const showZoomHint = currentData?.zoomRequired && !loading && mapRendered && !error
  const rawPoints = currentData?.points ?? EMPTY_POINTS
  const points = useMemo(() => {
    if (dataset === 'transactions') return groupTransactions(rawPoints)
    return rawPoints.filter(
      (point) =>
        (category === 'すべて' || point.category === category) &&
        (metric !== 'change' || point.change !== undefined),
    )
  }, [rawPoints, dataset, metric, category])
  const selected =
    selection &&
    (dataset === 'transactions'
      ? points.find((point) => point.id === selection.point.id)
      : (matchHistoryPoint(selection.point, points) ??
        (year === selection.year
          ? points.find((point) => point.id === selection.point.id)
          : undefined)))
  useMapTools({ dataset, metric, year, bounds, loading, error, points })
  const midpoint = median(points.map((point) => point.price))
  const medianChange = median(
    points.flatMap((point) => (point.change === undefined ? [] : [point.change])),
  )
  const ranking = useMemo(
    () =>
      [...points]
        .sort((a, b) =>
          metric === 'change' ? (b.change ?? 0) - (a.change ?? 0) : b.price - a.price,
        )
        .slice(0, 5),
    [points, metric],
  )
  const formatMetric = (point: PricePoint) =>
    metric === 'change' ? changeLabel(point.change) : priceLabel(point.price)

  function changeDataset(next: Dataset) {
    setDataset(next)
    setYear((value) => Math.max(FIRST_YEAR[next], value))
    setSelection(undefined)
    setPlaying(false)
    if (next === 'transactions') setMetric('price')
  }

  function changeYear(next: number) {
    setPlaying(false)
    setYear(next)
  }

  function showJapan() {
    cancelLocation()
    addressSearch.clear()
    setSelection(undefined)
    setSidebarOpen(false)
    map?.fitBounds(JAPAN_BOUNDS, { padding: 40, pitch: 0, bearing: 0, duration: 1200 })
  }

  function focusPoint(point: PricePoint) {
    handleSelect(point)
    setSidebarOpen(false)
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

          <section className="metric-section" aria-labelledby="metric-title">
            <div className="section-heading">
              <h3 id="metric-title">表示する指標</h3>
              <TrendingUp size={14} />
            </div>
            <div className="segmented metric-controls">
              {(
                [
                  { id: 'price', label: '価格' },
                  { id: 'change', label: '前年比（%）' },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={metric === id}
                  className={metric === id ? 'active' : ''}
                  disabled={id === 'change' && dataset === 'transactions'}
                  onClick={() => {
                    setMetric(id)
                    setPlaying(false)
                    if (id === 'change' && mode === 'heatmap') setMode('points')
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="metric-description">
              {dataset === 'transactions'
                ? '駅周辺の取引単価の中央値。前年比は未対応です。'
                : metric === 'change'
                  ? `${year - 1}年から${year}年への価格の変化率`
                  : '選択した年の土地1㎡あたりの価格'}
            </p>
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
                      setSelection(undefined)
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
              {metric === 'change' ? changeLabel(medianChange) : priceLabel(midpoint)}
              {metric !== 'change' && <small>万円 / ㎡</small>}
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
                {metric === 'change'
                  ? '表示領域の中で上昇率の高い地点'
                  : '表示領域の中で価格の高い地点'}
              </h3>
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
                    {formatMetric(point)}
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
        </footer>
      </aside>

      <section
        className={`map-workspace ${selection ? 'has-selection' : ''}`}
        aria-label="マップで探索"
      >
        <MapCanvas
          points={points}
          dataset={dataset}
          metric={metric}
          mode={mode}
          position={position}
          addressResult={addressSearch.result}
          selectedId={selected?.id}
          onBounds={handleBounds}
          onSelect={handleSelect}
          onReady={handleReady}
          onRendered={handleRendered}
        />
        <div className="map-vignette" />
        <button
          type="button"
          className="icon-button mobile-menu"
          aria-label="データパネルを開く"
          onClick={() => setSidebarOpen(true)}
        >
          <SlidersHorizontal size={18} />
        </button>

        <AddressSearch
          search={addressSearch}
          ready={Boolean(map)}
          onSearch={() => {
            cancelLocation()
            void addressSearch.search()
          }}
        />

        {(locating || locationError) && (
          <div className="location-notice" aria-live="polite">
            {locating ? <LoaderCircle size={14} className="spin" /> : <Info size={14} />}
            <span>{locating ? '現在地を取得中…' : locationError}</span>
          </div>
        )}

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
                  id === 'heatmap' && metric === 'change'
                    ? '前年比は3Dまたはポイントで表示します'
                    : `${label}表示`
                }
                disabled={id === 'heatmap' && metric === 'change'}
                aria-pressed={mode === id}
                className={mode === id ? 'active' : ''}
                onClick={() => setMode(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </fieldset>
        </div>

        {selection && (
          <PointDetails
            key={`${dataset}-${selection.point.id}`}
            selection={selection}
            currentPoint={selected}
            loading={loading}
            requests={requests}
            dataset={dataset}
            year={year}
            onClose={() => setSelection(undefined)}
          />
        )}

        <div className={`map-bottom ${showZoomHint ? 'has-zoom-hint' : ''}`}>
          <div className="map-context">
            <div className="legend" data-expanded={legendOpen}>
              <button
                type="button"
                className="legend-toggle"
                aria-expanded={legendOpen}
                aria-controls="map-legend"
                onClick={() => setLegendOpen((open) => !open)}
              >
                <Layers3 size={15} aria-hidden="true" />
                <span>{mode === '3d' ? '色と高さの見方' : '色の見方'}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              <div id="map-legend" className="legend-content">
                <div className="legend-title">
                  <span>
                    {metric === 'change'
                      ? '対前年変動率'
                      : mode === 'heatmap'
                        ? '価格で重み付けした密度'
                        : '㎡あたりの価格'}
                  </span>
                  <small>
                    {mode === 'heatmap' ? '相対値' : metric === 'change' ? '%' : '万円 / ㎡'}
                  </small>
                </div>
                <div
                  className="legend-gradient"
                  style={{
                    background: `linear-gradient(90deg, ${(metric === 'change' ? CHANGE_COLORS : PRICE_COLORS).join(',')})`,
                  }}
                />
                <div className="legend-labels">
                  {(mode === 'heatmap'
                    ? ['低い', '高い']
                    : metric === 'change'
                      ? ['−5', '0', '2', '5', '10', '20+']
                      : ['0', '30', '70', '150', '500', '1,500+']
                  ).map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                {mode === '3d' && (
                  <p>
                    {metric === 'change'
                      ? '高さは変動率の絶対値、色は増減を表します'
                      : '高さは価格の平方根に比例（上限6,500m）'}
                  </p>
                )}
              </div>
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
                  {showZoomHint ? <ZoomIn size={26} aria-hidden="true" /> : <Info size={14} />}
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
          </div>
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
              onClick={() => {
                addressSearch.clear()
                locate()
              }}
            >
              {locating ? <LoaderCircle size={17} className="spin" /> : <LocateFixed size={17} />}
            </button>
            <button type="button" aria-label="全国を表示" title="全国を表示" onClick={showJapan}>
              <Globe2 size={17} />
            </button>
          </div>
          <div className="timeline-group">
            <p className="timeline-period" aria-live="polite">
              {periodLabel(dataset, metric, year)}
            </p>
            <div className="timeline">
              <label className="timeline-label">
                <span>対象年</span>
                <select
                  aria-label="対象年"
                  value={year}
                  onChange={(event) => changeYear(Number(event.target.value))}
                >
                  {years.map((value) => (
                    <option key={value} value={value}>
                      {value}年
                    </option>
                  ))}
                </select>
              </label>
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
              <div className="year-selector" ref={yearSelector}>
                {years.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value}年を表示`}
                    title={periodLabel(dataset, metric, value)}
                    aria-pressed={year === value}
                    className={year === value ? 'active' : ''}
                    onClick={() => changeYear(value)}
                  >
                    <span className="year-tick" />
                    <span>{value}</span>
                  </button>
                ))}
              </div>
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
        <h3>住所検索</h3>
        <p>
          日本国内の住所を入力すると、その位置へ移動します。番地の座標がない場合は町丁目の代表点、町丁目まで分からない場合は市区町村役場や都道府県庁の位置を表示します。検索結果に表示される位置の精度を確認してください。施設名・建物名による検索には対応していません。
        </p>
        <p>
          住所の解析にはGeoloniaの住所正規化ライブラリを使い、必要な地域の住所データをブラウザから取得します。住所データはGeolonia作成のアドレス・ベース・レジストリ加工データ（CC
          BY 4.0）です。入力した住所はアプリに保存しません。
        </p>
        <a
          href="https://github.com/geolonia/japanese-addresses-v2/"
          target="_blank"
          rel="noreferrer"
        >
          住所データ：Geolonia <ExternalLink size={14} />
        </a>
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          住所データのライセンス：CC BY 4.0 <ExternalLink size={14} />
        </a>
        <h3>価格の読み方</h3>
        <p>
          公示地価は1月1日、基準地価は7月1日時点の土地1㎡あたりの価格です。マンション取引は土地の価格とは異なるため、直接比較できません。公表前の年度や対象地点のない範囲は空になります。
        </p>
        <p>
          公示地価・前年比は{FIRST_YEAR.land}年、基準地価は{FIRST_YEAR.survey}年、マンション取引は
          {FIRST_YEAR.transactions}
          年から選べます。2005年の取引は7〜12月のみです。前年比は変動率が提供されている地点だけを表示します。
        </p>
        <p>
          マンション取引は中古マンション等の取引価格情報を使用します。各取引の総額を面積で割り、同じ最寄り駅の座標ごとに中央値を算出しています。面積が「以上」等で表された取引は計算から除きます。地点の高さや地図上の位置は、建物の高さや物件所在地を表しません。
        </p>
        <h3>地点の価格推移</h3>
        <p>
          公示地価・基準地価の地点を選ぶと、対象年までの価格推移を表示します。初期表示は5年前からで、10年前から・全期間に切り替えられます。識別番号・所在地・位置から同じ地点と確認できた年のみ表示し、欠測や地点変更の前後は線をつなぎません。推移は選んだ地点周辺のデータから取得します。マンション取引の推移は未対応です。
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
