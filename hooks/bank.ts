import type { Bank, Treat } from '../types'

/** A turn's output is rounded up to the next multiple of this; the difference is saved. */
export const STEP = 100
/** The panel's gauge fills toward the next multiple of this. */
export const GOAL = 1000
export const MAX_TREATS = 30
export const MAX_ON_CHARS = 200

export const EMPTY: Bank = { balance: 0, saved: 0, spent: 0, roundUps: 0, last: null, treats: [] }

/** The change a turn drops in: 1 to 100 tokens, 0 when the turn generated nothing. */
export function roundUp(outputTokens: number): number {
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) {
    return 0
  }

  return STEP - (Math.floor(outputTokens) % STEP)
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function asTreat(value: unknown): Treat | null {
  if (value === null || typeof value !== 'object') {
    return null
  }

  const { at, tokens, on } = value as Record<string, unknown>

  return count(tokens) > 0 && typeof on === 'string' ? { at: count(at), tokens: count(tokens), on } : null
}

/** Reads whatever the store holds as a bank; anything unreadable counts as empty. */
export function asBank(raw: unknown): Bank {
  if (raw === null || typeof raw !== 'object') {
    return EMPTY
  }

  const r = raw as Record<string, unknown>
  const last = r.last !== null && typeof r.last === 'object' ? (r.last as Record<string, unknown>) : null
  const treats = Array.isArray(r.treats) ? r.treats.map(asTreat).filter((t): t is Treat => t !== null) : []

  return {
    balance: count(r.balance),
    saved: count(r.saved),
    spent: count(r.spent),
    roundUps: count(r.roundUps),
    last: last && count(last.tokens) > 0 ? { tokens: count(last.tokens), at: count(last.at) } : null,
    treats: treats.slice(0, MAX_TREATS),
  }
}

export function deposit(bank: Bank, tokens: number, at: number): Bank {
  return {
    ...bank,
    balance: bank.balance + tokens,
    saved: bank.saved + tokens,
    roundUps: bank.roundUps + 1,
    last: { tokens, at },
  }
}

/** Takes `tokens` out for `on`, or says why not. */
export function withdraw(bank: Bank, tokens: number, on: string, at: number): { bank: Bank } | { deny: string } {
  const what = on.trim().replace(/\s+/g, ' ').slice(0, MAX_ON_CHARS)

  if (!Number.isInteger(tokens) || tokens < 1) {
    return { deny: 'tokens must be a whole number of at least 1.' }
  }

  if (what === '') {
    return { deny: 'Say what the tokens are for in `on`.' }
  }

  if (tokens > bank.balance) {
    return { deny: `Not enough saved: the piggy bank holds ${fmt(bank.balance)} tokens and this asks for ${fmt(tokens)}.` }
  }

  return {
    bank: {
      ...bank,
      balance: bank.balance - tokens,
      spent: bank.spent + tokens,
      treats: [{ at, tokens, on: what }, ...bank.treats].slice(0, MAX_TREATS),
    },
  }
}

/** 12345 -> "12,345" */
export function fmt(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 15", in the machine's own time zone. */
export function dayLabel(at: number): string {
  const d = new Date(at)

  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}`
}

/** The bank in words, for the model and for the slash command's answer. */
export function describe(bank: Bank): string {
  const lines = [
    `Piggy bank: ${fmt(bank.balance)} tokens saved.`,
    `All-time: ${fmt(bank.saved)} saved over ${fmt(bank.roundUps)} round-ups, ${fmt(bank.spent)} spent.`,
  ]

  if (bank.treats.length > 0) {
    lines.push('Recent treats:')
    for (const t of bank.treats.slice(0, 5)) {
      lines.push(`- ${fmt(t.tokens)} tokens on ${t.on} (${dayLabel(t.at)})`)
    }
  } else {
    lines.push('Nothing has been bought yet.')
  }

  return lines.join('\n')
}
