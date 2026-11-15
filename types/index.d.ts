/** One thing Claude bought with savings. */
export type Treat = {
  /** Epoch ms of the purchase */
  at: number
  /** Tokens taken out of the bank for it */
  tokens: number
  /** What Claude said it was for */
  on: string
  /** It was the savings goal Claude had been saving up for */
  isGoal?: true
}

/** What Claude is saving up for, set with the save_for tool. */
export type Goal = {
  /** A few words naming it */
  what: string
  /** Roughly how many tokens it takes */
  tokens: number
  /** Epoch ms it was set */
  since: number
}

/** The piggy bank, as the store keeps it and the panel draws it. */
export type Bank = {
  /** Tokens in the bank now */
  balance: number
  /** Every token ever put in */
  saved: number
  /** Every token ever taken out */
  spent: number
  /** How many turns dropped their change in */
  roundUps: number
  /** The latest round-up, null before the first */
  last: { tokens: number; at: number } | null
  /** Purchases, newest first */
  treats: Treat[]
  /** What Claude is saving up for, null when nothing */
  goal: Goal | null
}

declare module 'claude-code' {
  interface PluginState {
    'piggy-bank': {
      bank: Shaped<Bank>
    }
  }
}
