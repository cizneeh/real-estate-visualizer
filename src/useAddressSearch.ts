import { useCallback, useEffect, useRef, useState } from 'react'
import { type AddressResult, searchAddress } from './geocoding'

export function useAddressSearch() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<AddressResult>()
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string>()
  const requestId = useRef(0)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const cancel = useCallback(() => {
    requestId.current++
    clearTimeout(timeout.current)
    timeout.current = undefined
  }, [])

  useEffect(() => cancel, [cancel])

  function editQuery(value: string) {
    cancel()
    setQuery(value)
    setResult(undefined)
    setError(undefined)
    setSearching(false)
  }

  async function search() {
    const address = query.trim()
    if (!address) return
    cancel()
    const id = requestId.current
    setQuery(address)
    setResult(undefined)
    setError(undefined)
    setSearching(true)
    timeout.current = setTimeout(() => {
      cancel()
      setSearching(false)
      setError('検索に時間がかかっています。通信環境を確認して、もう一度検索してください。')
    }, 15_000)
    try {
      const found = await searchAddress(address)
      if (id !== requestId.current) return
      setResult(found)
      if (!found) setError('住所を特定できませんでした。都道府県から始まる住所で検索してください。')
    } catch {
      if (id !== requestId.current) return
      setError('住所データを取得できませんでした。通信環境を確認して、もう一度検索してください。')
    } finally {
      if (id === requestId.current) {
        clearTimeout(timeout.current)
        timeout.current = undefined
        setSearching(false)
      }
    }
  }

  return { query, result, searching, error, editQuery, search, clear: () => editQuery('') }
}
