import { Info } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

export function LandPriceHelp() {
  const [open, setOpen] = useState(false)
  const id = useId()
  const container = useRef<HTMLFieldSetElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  return (
    <fieldset
      aria-label="土地価格の補足"
      className="land-price-help"
      ref={container}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!container.current?.contains(document.activeElement)) setOpen(false)
      }}
    >
      <button
        type="button"
        className="land-price-help-button"
        aria-label="土地価格の出典について"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        aria-controls={id}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            event.stopPropagation()
          }
        }}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      <div id={id} role="tooltip" className="land-price-tooltip" hidden={!open}>
        公示地価（1月1日時点）と基準地価（7月1日時点）をもとに、土地1㎡あたりの価格を表示しています。
        選択した年に両方の価格がある同一地点は、新しい価格を採用します。建物の価格は含みません。
      </div>
    </fieldset>
  )
}
