import type { TransactionType } from './types'

export const DEFAULT_TRANSACTION_TYPE: TransactionType = 'condominium'

export const TRANSACTION_TYPES = {
  condominium: {
    code: '07',
    label: '中古マンション等',
    description: '取引総額 ÷ 専有面積',
    priceMeaning: 'マンション等の取引総額を専有面積で割った㎡単価',
  },
  land: {
    code: '01',
    label: '宅地（土地）',
    description: '土地のみの取引',
    priceMeaning: '土地のみの取引価格の㎡単価',
  },
  'land-building': {
    code: '02',
    label: '宅地（土地と建物）',
    description: '建物込みの取引総額 ÷ 土地面積',
    priceMeaning: '建物込みの取引総額を土地面積で割った㎡単価（土地だけの価格ではありません）',
  },
} satisfies Record<
  TransactionType,
  { code: string; label: string; description: string; priceMeaning: string }
>

export const transactionTypes = Object.keys(TRANSACTION_TYPES) as TransactionType[]

export function validTransactionType(value: string): value is TransactionType {
  return Object.hasOwn(TRANSACTION_TYPES, value)
}
