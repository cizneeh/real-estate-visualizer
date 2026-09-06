import { useCallback, useEffect, useRef, useState } from 'react'
import { JAPAN_BOUNDS } from './types'

export function useCurrentLocation() {
  const [position, setPosition] = useState<[number, number]>()
  const [locating, setLocating] = useState(true)
  const [error, setError] = useState<string>()
  const requestId = useRef(0)

  const locate = useCallback(() => {
    const id = ++requestId.current
    setLocating(true)
    setError(undefined)
    if (!navigator.geolocation) {
      setLocating(false)
      setError('このブラウザでは現在地を取得できません。地図から地域を選んでください。')
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
          setError('現在地は地図の表示範囲外です。日本国内の地域を選んでください。')
          return
        }
        setPosition([coords.longitude, coords.latitude])
      },
      (cause) => {
        if (requestId.current !== id) return
        setError(
          cause.code === 1
            ? '位置情報が許可されていません。地図から地域を選ぶか、ブラウザの設定で許可してください。'
            : '現在地を取得できませんでした。地図から地域を選ぶか、現在地ボタンで再試行してください。',
        )
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 },
    )
  }, [])

  useEffect(() => {
    locate()
    return () => {
      requestId.current++
    }
  }, [locate])

  return { position, locating, error, locate }
}
