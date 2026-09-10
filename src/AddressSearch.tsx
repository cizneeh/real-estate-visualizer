import { LoaderCircle, Search, X } from 'lucide-react'
import { useRef } from 'react'
import type { useAddressSearch } from './useAddressSearch'

interface Props {
  search: ReturnType<typeof useAddressSearch>
  ready: boolean
  onSearch: () => void
}

export function AddressSearch({ search, ready, onSearch }: Props) {
  const input = useRef<HTMLInputElement | null>(null)
  return (
    <search className="address-search" aria-label="住所検索">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!ready || search.searching || !search.query.trim()) return
          onSearch()
          input.current?.blur()
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          type="text"
          aria-label="住所"
          aria-describedby="address-search-feedback"
          placeholder="住所を入力して移動"
          value={search.query}
          maxLength={200}
          autoComplete="off"
          enterKeyHint="search"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          }}
          onChange={(event) => search.editQuery(event.target.value)}
        />
        {search.query && (
          <button
            type="button"
            className="address-clear"
            aria-label="住所検索をクリア"
            onClick={() => {
              search.clear()
              input.current?.focus()
            }}
          >
            <X size={16} />
          </button>
        )}
        <button type="submit" disabled={!ready || search.searching || !search.query.trim()}>
          {search.searching ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : (
            '検索'
          )}
          {search.searching && <span className="visually-hidden">検索中</span>}
        </button>
      </form>
      <div
        id="address-search-feedback"
        className="address-feedback"
        aria-live="polite"
        aria-atomic="true"
      >
        {search.searching ? (
          <p>住所を検索中…</p>
        ) : search.error ? (
          <p className="address-error">{search.error}</p>
        ) : search.result ? (
          <p>
            <strong>{search.result.label}</strong>
            <span>{search.result.precision}</span>
          </p>
        ) : undefined}
      </div>
    </search>
  )
}
