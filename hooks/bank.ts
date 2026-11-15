import type { Bank, Goal, Treat } from '../types'

/** A turn's output is rounded up to the next multiple of this; the difference is saved. */
export const STEP = 100
/** The panel's gauge fills toward the next multiple of this. */
export const GOAL = 1000
export const MAX_TREATS = 30
export const MAX_ON_CHARS = 200
/** The biggest savings goal Claude can set. */
export const MAX_GOAL = 1_000_000

export const EMPTY: Bank = { balance: 0, saved: 0, spent: 0, roundUps: 0, last: null, treats: [], goal: null }

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

  const { at, tokens, on, isGoal } = value as Record<string, unknown>

  if (count(tokens) === 0 || typeof on !== 'string') {
    return null
  }

  return isGoal === true ? { at: count(at), tokens: count(tokens), on, isGoal: true } : { at: count(at), tokens: count(tokens), on }
}

function asGoal(value: unknown): Goal | null {
  if (value === null || typeof value !== 'object') {
    return null
  }

  const { what, tokens, since } = value as Record<string, unknown>

  return typeof what === 'string' && what !== '' && count(tokens) > 0
    ? { what, tokens: Math.min(count(tokens), MAX_GOAL), since: count(since) }
    : null
}

function tidy(words: string): string {
  return words.trim().replace(/\s+/g, ' ').slice(0, MAX_ON_CHARS)
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
    goal: asGoal(r.goal),
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

/** Records what Claude is saving up for, replacing any earlier goal, or says why not. */
export function setGoal(bank: Bank, what: string, tokens: number, at: number): { bank: Bank } | { deny: string } {
  const name = tidy(what)

  if (name === '') {
    return { deny: 'Say what you are saving up for in `what`.' }
  }

  if (!Number.isInteger(tokens) || tokens < 1 || tokens > MAX_GOAL) {
    return { deny: `tokens must be a whole number from 1 to ${fmt(MAX_GOAL)}.` }
  }

  return { bank: { ...bank, goal: { what: name, tokens, since: at } } }
}

/**
 * Takes `tokens` out for `on`, or says why not. With `isGoal`, it is the goal
 * Claude was saving up for: the treat is marked so and the goal is cleared.
 */
export function withdraw(
  bank: Bank,
  tokens: number,
  on: string,
  at: number,
  isGoal = false,
): { bank: Bank } | { deny: string } {
  const what = tidy(on)

  if (!Number.isInteger(tokens) || tokens < 1) {
    return { deny: 'tokens must be a whole number of at least 1.' }
  }

  if (what === '') {
    return { deny: 'Say what the tokens are for in `on`.' }
  }

  if (tokens > bank.balance) {
    return { deny: `Not enough saved: the piggy bank holds ${fmt(bank.balance)} tokens and this asks for ${fmt(tokens)}.` }
  }

  if (isGoal && bank.goal === null) {
    return { deny: 'There is no savings goal to buy: leave out isGoal, or set one with save_for.' }
  }

  const treat: Treat = isGoal ? { at, tokens, on: what, isGoal: true } : { at, tokens, on: what }

  return {
    bank: {
      ...bank,
      balance: bank.balance - tokens,
      spent: bank.spent + tokens,
      treats: [treat, ...bank.treats].slice(0, MAX_TREATS),
      goal: isGoal ? null : bank.goal,
    },
  }
}

/** What the panel's bar fills toward: the savings goal, or else the next thousand. */
export function target(bank: Bank): { value: number; max: number; label: string; isReached: boolean } {
  if (bank.goal !== null) {
    return {
      value: Math.min(bank.balance, bank.goal.tokens),
      max: bank.goal.tokens,
      label: `Saving for ${bank.goal.what}`,
      isReached: bank.balance >= bank.goal.tokens,
    }
  }

  return { value: bank.balance % GOAL, max: GOAL, label: 'To the next thousand', isReached: false }
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

  if (bank.goal !== null) {
    const { what, tokens, since } = bank.goal
    const state =
      bank.balance >= tokens ? 'enough is saved now' : `${fmt(tokens - bank.balance)} to go`

    lines.push(`Saving for: ${what}, ${fmt(tokens)} tokens (set ${dayLabel(since)}; ${state}).`)
  } else {
    lines.push('Not saving for anything in particular.')
  }

  if (bank.treats.length > 0) {
    lines.push('Recent treats:')
    for (const t of bank.treats.slice(0, 5)) {
      lines.push(`- ${fmt(t.tokens)} tokens on ${t.on}${t.isGoal ? ', saved up for' : ''} (${dayLabel(t.at)})`)
    }
  } else {
    lines.push('Nothing has been bought yet.')
  }

  return lines.join('\n')
}
