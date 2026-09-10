import { useCallback, useEffect, useRef, useState } from 'react'
import { JAPAN_BOUNDS } from './types'

export function useCurrentLocation() {
  const [position, setPosition] = useState<[number, number]>()
  const [locating, setLocating] = useState(true)
  const [error, setError] = useState<string>()
  const requestId = useRef(0)
  const errorTimer = useRef<number | undefined>(undefined)

  const showError = useCallback((message: string) => {
    window.clearTimeout(errorTimer.current)
    setError(message)
    errorTimer.current = window.setTimeout(() => {
      setError(undefined)
      errorTimer.current = undefined
    }, 5000)
  }, [])

  const locate = useCallback(() => {
    const id = ++requestId.current
    window.clearTimeout(errorTimer.current)
    errorTimer.current = undefined
    setLocating(true)
    setError(undefined)
    if (!navigator.geolocation) {
      setLocating(false)
      showError('このブラウザでは現在地を取得できません。地図から地域を選んでください。')
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (requestId.current !== id) return
        setLocating(false)
        if (
          coords.longitude < JAPAN_BOUNDS[0] ||
          coords.latitude < JAPAN_BOUNDS[1] ||
          coords.longitude > JAPAN_BOUNDS[2] ||
          coords.latitude > JAPAN_BOUNDS[3]
        ) {
          setPosition(undefined)
          showError('現在地は地図の表示範囲外です。日本国内の地域を選んでください。')
          return
        }
        setPosition([coords.longitude, coords.latitude])
      },
      (cause) => {
        if (requestId.current !== id) return
        showError(
          cause.code === 1
            ? '位置情報が許可されていません。地図から地域を選ぶか、ブラウザの設定で許可してください。'
            : '現在地を取得できませんでした。地図から地域を選ぶか、現在地ボタンで再試行してください。',
        )
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
    )
  }, [showError])

  useEffect(() => {
    locate()
    return () => {
      requestId.current++
      window.clearTimeout(errorTimer.current)
    }
  }, [locate])

  const cancel = useCallback(() => {
    requestId.current++
    window.clearTimeout(errorTimer.current)
    errorTimer.current = undefined
    setLocating(false)
    setError(undefined)
  }, [])

  return { position, locating, error, locate, cancel }
}
