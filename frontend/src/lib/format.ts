export const inr = (v: number) => '₹' + Math.round(v).toLocaleString('en-IN')

export type IssueKey = 'price' | 'trial' | 'zombie' | 'unk' | 'ok'

export const issueOf = (m: { flag?: string; flags?: string[]; is_recognized?: boolean }): IssueKey => {
  const f = (m.flag || (m.flags && m.flags[0]) || '').toUpperCase()
  if (f === 'PRICE_HIKE' || f === 'PRICE_CREEP' || f === 'PRICE') return 'price'
  if (f === 'TRIAL_CONVERTED' || f === 'TRIAL_TRAP' || f === 'TRIAL') return 'trial'
  if (f === 'UNUSED_ZOMBIE' || f === 'ZOMBIE' || f === 'UNUSED') return 'zombie'
  if (m.is_recognized === false) return 'unk'
  return 'ok'
}

export const ISSUE_LABEL: Record<IssueKey, string> = {
  price: 'Price creep', trial: 'Trial trap', zombie: 'Unused', unk: 'Unrecognised', ok: 'Looks fine'
}
