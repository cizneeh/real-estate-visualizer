import { useLayoutEffect, useRef, useState } from 'react'
import type { HistoryEntry } from './history'
import { historyLineReveals } from './historyAnimation'

export function useHistoryChartAnimation(entries: HistoryEntry[], low: number, high: number) {
  const svg = useRef<SVGSVGElement>(null)
  const previousYears = useRef(
    new Set(entries.filter((entry) => entry.point).map(({ year }) => year)),
  )
  const arrivals = useRef(new Map<number, number>())
  const animations = useRef(new Set<Animation>())
  const hasValues = entries.some((entry) => entry.point)
  const hadValues = useRef(hasValues)
  const [range, setRange] = useState({ low, high })
  const rangeRef = useRef(range)

  useLayoutEffect(() => {
    const running = animations.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finish = () => {
      if (reduced.matches) for (const animation of running) animation.finish()
    }
    reduced.addEventListener('change', finish)
    return () => {
      reduced.removeEventListener('change', finish)
      for (const animation of running) animation.cancel()
      running.clear()
    }
  }, [])

  useLayoutEffect(() => {
    const previous = previousYears.current
    previousYears.current = new Set(entries.filter((entry) => entry.point).map(({ year }) => year))
    if (!svg.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const now = performance.now()
    const animate = (element: Element, keyframes: Keyframe[], duration: number, delay = 0) => {
      const animation = element.animate(keyframes, {
        duration,
        delay,
        easing: 'cubic-bezier(0.25, 0.65, 0.35, 1)',
        fill: 'backwards',
      })
      animations.current.add(animation)
      animation.onfinish = animation.oncancel = () => animations.current.delete(animation)
    }
    for (const reveal of historyLineReveals(entries, previous)) {
      const line = svg.current.querySelector(`.history-line[data-year="${reveal.startYear}"]`)
      if (!line) continue
      const from = reveal.reverse ? reveal.endYear : reveal.startYear
      const to = reveal.reverse ? reveal.startYear : reveal.endYear
      const delay = Math.max(reveal.delay, (arrivals.current.get(from) ?? now) - now)
      const arrival = now + delay + reveal.duration
      arrivals.current.set(to, Math.min(arrivals.current.get(to) ?? arrival, arrival))
      animate(
        line,
        [{ strokeDashoffset: reveal.reverse ? -1 : 1 }, { strokeDashoffset: 0 }],
        reveal.duration,
        delay,
      )
    }
    for (const entry of entries) {
      if (!entry.point || previous.has(entry.year)) continue
      const dot = svg.current.querySelector(`.history-dot[data-year="${entry.year}"]`)
      if (dot)
        animate(
          dot,
          [{ opacity: 0 }, { opacity: 1 }],
          180,
          Math.max(0, (arrivals.current.get(entry.year) ?? now) - now - 90),
        )
    }
  }, [entries])

  useLayoutEffect(() => {
    const from = rangeRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const update = (next: typeof range) => {
      rangeRef.current = next
      setRange(next)
    }
    const finish = () => {
      cancelAnimationFrame(frame)
      update({ low, high })
    }
    const shouldAnimate = hadValues.current && hasValues && !reduced.matches
    hadValues.current = hasValues
    if (!shouldAnimate) {
      finish()
      return
    }
    if (from.low === low && from.high === high) return
    const started = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 360)
      const eased = 1 - (1 - progress) ** 3
      update({
        low: from.low + (low - from.low) * eased,
        high: from.high + (high - from.high) * eased,
      })
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    const onMotionChange = () => {
      if (reduced.matches) finish()
    }
    reduced.addEventListener('change', onMotionChange)
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      reduced.removeEventListener('change', onMotionChange)
    }
  }, [low, high, hasValues])

  return { svg, low: range.low, high: range.high }
}
