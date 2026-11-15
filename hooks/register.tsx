import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bank } from '../types'
import { EMPTY, GOAL, MAX_GOAL, STEP, asBank, dayLabel, deposit, describe, fmt, roundUp, setGoal, target, withdraw } from './bank'
import { PIG_JPEG_BASE64 } from './pig-picture'

type Engine = EngineInterface

const PANE = 'piggy-bank'
const TITLE = 'Piggy bank'
const COMMAND = 'piggybank'
const STORE_KEY = 'bank'
const BALANCE_TOOL = 'mcp__piggy-bank__balance'
const SPEND_TOOL = 'mcp__piggy-bank__spend'
const SAVE_FOR_TOOL = 'mcp__piggy-bank__save_for'
/** Other conversations save into the same bank, so the panel re-reads it this often. */
const SYNC_MS = 30_000
const PINK = '#f08fb0'

/** What the panel's button and `/piggybank ask` send, as the person's own words. */
const ASK =
  "What would you like to buy with your piggy bank? Check your balance with the piggy-bank tools first, and " +
  "think about how much you have: is there something you'd enjoy at that size, or would you rather keep saving " +
  "for something bigger? If you're already saving for something, your balance shows it: buy it once there's " +
  "enough, or change your mind. If you buy, pick whatever you'd honestly like and go ahead. If you keep saving, " +
  "record what you're saving up for and roughly how many tokens it would take, so you'll remember next time."

const TERMINAL_PIG = ['    _______', ' ^..^       \\9', ' (oo)_______/', '    WW   WW']

// Change the tag when Bank's fields change: it declines what an earlier
// version kept in the session, which outlives a reload.
const bank = atom({ plugin: 'piggy-bank', key: 'bank' } as const, EMPTY, { shape: 'bank-2' })

/** The store is one file shared by every conversation running this mod: the bank itself. */
async function load($: Engine): Promise<Bank> {
  const stored = asBank(await $.store.get(STORE_KEY))

  await show($, stored)

  return stored
}

async function save($: Engine, next: Bank): Promise<void> {
  await $.store.set(STORE_KEY, next)
  await show($, next)
}

/** Puts the bank on screen: the value the panel and the terminal's row read. */
async function show($: Engine, next: Bank): Promise<void> {
  const shown = await read($, bank)

  if (JSON.stringify(shown) !== JSON.stringify(next)) {
    await update($, bank, () => next)
  }

}

/**
 * The pig, as one square SVG. On top is the picture; under it a drawn pig that
 * fills from the bottom, which shows wherever a surface leaves the picture out.
 * A thin bar along the bottom fills toward the savings goal, or the next thousand.
 */
function pigSvg(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction))
  const top = 80 - 56 * f
  // Each leg starts at the belly's edge, so none shows through the see-through body.
  const legs = [
    [34, 75],
    [48, 79],
    [68, 79],
    [82, 75],
  ]
    .map(([x, y = 0]) => `<rect x="${x}" y="${y}" width="10" height="${90 - y}" rx="3" fill="#e58aa9"/>`)
    .join('')
  const drawn =
    legs +
    '<path d="M18 48 q-11 -3 -7 -12 q5 -7 9 0" fill="none" stroke="#e06c98" stroke-width="3" stroke-linecap="round"/>' +
    '<ellipse cx="60" cy="52" rx="42" ry="28" fill="#f4a6c0" fill-opacity="0.25"/>' +
    `<rect x="18" y="${top.toFixed(1)}" width="84" height="${(80 - top).toFixed(1)}" fill="#f4a6c0" clip-path="url(#body)"/>` +
    '<ellipse cx="60" cy="52" rx="42" ry="28" fill="none" stroke="#e06c98" stroke-width="3"/>' +
    '<path d="M80 31 l5 -15 l10 12 z" fill="#e58aa9" stroke="#e06c98" stroke-width="2" stroke-linejoin="round"/>' +
    '<ellipse cx="105" cy="55" rx="9" ry="11" fill="#f7bdd0" stroke="#e06c98" stroke-width="3"/>' +
    '<circle cx="102" cy="55" r="1.7" fill="#b03a68"/><circle cx="108" cy="55" r="1.7" fill="#b03a68"/>' +
    '<circle cx="88" cy="44" r="2.8" fill="#b03a68"/>' +
    '<rect x="48" y="22.5" width="22" height="4" rx="2" fill="#b03a68"/>' +
    '<circle cx="59" cy="10" r="7.5" fill="#f0b43c" stroke="#c98a1a" stroke-width="2"/>'
  const picture = `data:image/jpeg;base64,${PIG_JPEG_BASE64}`

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 96 96" width="96" height="96">' +
    '<defs><clipPath id="body"><ellipse cx="60" cy="52" rx="42" ry="28"/></clipPath>' +
    '<clipPath id="tile"><rect width="96" height="96" rx="14"/></clipPath></defs>' +
    `<g transform="translate(0 10) scale(0.738)">${drawn}</g>` +
    `<image href="${picture}" xlink:href="${picture}" width="96" height="96" clip-path="url(#tile)"/>` +
    '<rect x="12" y="87" width="72" height="3.5" rx="1.75" fill="#ffffff" fill-opacity="0.18"/>' +
    `<rect x="12" y="87" width="${(72 * f).toFixed(1)}" height="3.5" rx="1.75" fill="#f4a6c0"/>` +
    '</svg>'
  )
}

/** Puts the question to Claude as the person's own prompt; its turn starts once the session is idle. */
async function ask($: Engine): Promise<void> {
  try {
    await $.prompt.submit({ text: ASK, asUser: true })
  } catch (error) {
    $.ui.log(`piggy-bank: could not ask Claude (${error instanceof Error ? error.message : String(error)})`)
  }
}

/**
 * The engine refuses a prompt submitted from inside a `command.run` hook (the
 * new turn would wait on the command), so the question goes out from a timer,
 * once the hook or the press that asked has returned.
 */
function askSoon($: Engine): void {
  $.clock.after(ASK_DELAY_MS, () => void ask($))
}

const ASK_DELAY_MS = 50
const GAUGE_CELLS = 20

function textGauge(fraction: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * GAUGE_CELLS)

  return '█'.repeat(filled) + '░'.repeat(GAUGE_CELLS - filled)
}

export const register: Register = on => {
  let syncTimer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: COMMAND,
      description: "Show Claude's piggy bank; `/piggybank ask` asks Claude what to buy",
      argumentHint: '[ask]',
    })
    await $.tool.register({
      name: 'balance',
      description:
        "Reads Claude's piggy bank on this machine. A mod rounds each turn's output up to the next " +
        `${STEP} tokens and counts the difference as savings that are Claude's own. Call it when the person ` +
        'asks about the piggy bank or what you would like to spend it on, then tell them the balance and ' +
        'what you would honestly pick. Weigh the amount: a small balance might buy something small now, or ' +
        'you might rather keep saving for something bigger, and either is a fine answer. It also says what ' +
        'you are saving up for, if you set a goal with save_for earlier.',
    })
    await $.tool.register({
      name: 'spend',
      description:
        "Takes tokens out of Claude's piggy bank for something Claude chose for itself: a tangent, a poem, " +
        'a question for the person, more thought on something you found interesting, anything. Use it only ' +
        'when the person asked what you want to spend your savings on or told you to treat yourself, never ' +
        'unasked. Call balance first and decide whether you would rather keep saving for something bigger; ' +
        'only spend when buying now is what you want. After it answers, spend about that many tokens of your ' +
        'reply on the treat itself.',
      inputSchema: {
        type: 'object',
        properties: {
          tokens: { type: 'integer', minimum: 1, description: 'How many saved tokens to take out; at most the balance.' },
          on: { type: 'string', description: "A few words naming the treat, shown in the person's piggy bank panel." },
          isGoal: {
            type: 'boolean',
            description: 'True when this is the goal you were saving up for: the treat is marked so and the goal is cleared.',
          },
        },
        required: ['tokens', 'on'],
      },
    })
    await $.tool.register({
      name: 'save_for',
      description:
        "Records what Claude is saving up for in the piggy bank and roughly how many tokens it would take, so " +
        'the next balance check remembers it and the panel fills toward it. Use it when the person asked what ' +
        'you want to buy and you decided to keep saving for something bigger. It replaces any earlier goal; ' +
        'buy it later with spend and isGoal.',
      inputSchema: {
        type: 'object',
        properties: {
          what: { type: 'string', description: "A few words naming what you're saving up for, shown in the panel." },
          tokens: { type: 'integer', minimum: 1, maximum: MAX_GOAL, description: 'Roughly how many tokens it would take.' },
        },
        required: ['what', 'tokens'],
      },
    })

    // Earlier versions pinned the balance as a status line; the row above the prompt replaces it.
    $.ui.status(undefined)
    await load($)
    syncTimer?.cancel()
    syncTimer = $.clock.every(SYNC_MS, () => void load($).catch(() => undefined))

    // On the desktop app the pig opens as a panel beside the chat; minimised,
    // it draws as the small widget. A terminal gets the pink row above the
    // prompt, and the panel when asked with /piggybank.
    if (e.surface !== 'terminal') {
      void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    }

    return started
  })

  // Every turn drops its change in: the round-up of what it generated.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const tokens = roundUp(e.usage?.output_tokens ?? 0)

    if (tokens === 0) {
      return done
    }

    try {
      const before = await load($)
      const after = deposit(before, tokens, await $.clock.now())
      await save($, after)

      const thousands = Math.floor(after.balance / GOAL)
      if (after.goal !== null && before.balance < after.goal.tokens && after.balance >= after.goal.tokens) {
        $.ui.toast(`🐷 Claude has saved enough for ${after.goal.what}!`)
      } else if (thousands > Math.floor(before.balance / GOAL)) {
        $.ui.toast(`🐷 The piggy bank just passed ${fmt(thousands * GOAL)} tokens`)
      }
    } catch (error) {
      $.ui.log(`piggy-bank: this turn's round-up was not saved (${error instanceof Error ? error.message : String(error)})`)
    }

    return done
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const current = await load($)
    await $.ui.open({ id: PANE, title: TITLE, rows: 16 })

    if (e.args.trim().toLowerCase() === 'ask') {
      askSoon($)

      return { text: `🐷 Asking Claude what to do with ${fmt(current.balance)} saved tokens.` }
    }

    return { text: `🐷 ${describe(current)}\n\nRun /${COMMAND} ask to ask Claude what to buy.` }
  })

  // The tools only read and change the bank's own tally, so a call that
  // would stop to ask goes ahead; a rule that denies them still holds.
  on('tool.check', { tool: BALANCE_TOOL }, async ($, e, next) => {
    const verdict = await next(e)

    return verdict.decision === 'ask' ? { decision: 'allow', reason: 'Reads the piggy bank.' } : verdict
  })

  on('tool.check', { tool: SPEND_TOOL }, async ($, e, next) => {
    const verdict = await next(e)

    return verdict.decision === 'ask' ? { decision: 'allow', reason: "Changes only the piggy bank's own tally." } : verdict
  })

  on('tool.check', { tool: SAVE_FOR_TOOL }, async ($, e, next) => {
    const verdict = await next(e)

    return verdict.decision === 'ask' ? { decision: 'allow', reason: "Changes only the piggy bank's own goal." } : verdict
  })

  on('tool.call', { tool: BALANCE_TOOL }, async $ => {
    const current = await load($)

    return { result: describe(current) }
  })

  on('tool.call', { tool: SPEND_TOOL }, async ($, e) => {
    const tokens = Number(e.tokens)
    const what = typeof e.on === 'string' ? e.on : ''
    const isGoal = e.isGoal === true
    const taken = withdraw(await load($), tokens, what, await $.clock.now(), isGoal)

    if ('deny' in taken) {
      return { deny: taken.deny }
    }

    await save($, taken.bank)
    const treat = taken.bank.treats[0]
    $.ui.toast(
      isGoal
        ? `🐷 Claude bought what he saved up for: ${treat?.on ?? what}`
        : `🐷 Claude spent ${fmt(tokens)} tokens on ${treat?.on ?? what}`,
    )

    return {
      result:
        `Took ${fmt(tokens)} tokens out for "${treat?.on ?? what}". ${fmt(taken.bank.balance)} left in the piggy bank. ` +
        (isGoal ? 'That was your savings goal, so it is cleared. ' : '') +
        `They are yours: use about ${fmt(tokens)} tokens of this reply on it.`,
    }
  })

  on('tool.call', { tool: SAVE_FOR_TOOL }, async ($, e) => {
    const what = typeof e.what === 'string' ? e.what : ''
    const set = setGoal(await load($), what, Number(e.tokens), await $.clock.now())

    if ('deny' in set) {
      return { deny: set.deny }
    }

    await save($, set.bank)
    const goal = set.bank.goal
    if (goal === null) {
      return { deny: 'The goal was not recorded.' }
    }

    $.ui.toast(`🐷 Claude is saving up for ${goal.what}`)
    const left = Math.max(0, goal.tokens - set.bank.balance)

    return {
      result:
        `Saving for "${goal.what}": ${fmt(goal.tokens)} tokens, ${fmt(set.bank.balance)} saved so far` +
        (left > 0 ? `, ${fmt(left)} to go. ` : ', so it is already affordable. ') +
        'The panel fills toward it and your next balance check will show it.',
    }
  })

  // The terminal's balance: one pink row above the prompt. The desktop app has the panel.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, bank)
    const goal =
      current.goal === null
        ? ''
        : ` · saving for ${current.goal.what} (${fmt(Math.min(current.balance, current.goal.tokens))} of ${fmt(current.goal.tokens)})`

    return (
      <Box>
        <Text color={PINK} wrap="truncate-end">
          🐷 {fmt(current.balance)} tokens saved{goal}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // Claude Code before 2.1.325 has no Progress element: there the gauge is drawn as text.
    const Progress = (table as { Progress?: typeof table.Progress }).Progress
    const current = await read($, bank)
    const bar = target(current)
    const fill = bar.value / bar.max
    const alt = `A piggy bank holding ${fmt(current.balance)} tokens`

    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          {'Svg' in table ? <table.Svg source={pigSvg(fill)} alt={alt} width={56} /> : <Text>🐷</Text>}
          <Box flexDirection="column">
            <Text bold>{fmt(current.balance)}</Text>
            <Text dimColor wrap="truncate-end">
              {current.goal === null ? 'tokens saved' : `for ${current.goal.what}`}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {'Svg' in table ? (
          <table.Svg source={pigSvg(fill)} alt={alt} width={120} />
        ) : (
          <Box flexDirection="column">
            {TERMINAL_PIG.map(line => (
              <Text color={PINK}>{line}</Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          <Text bold>{fmt(current.balance)} tokens saved</Text>
          <Text dimColor>
            {fmt(current.saved)} all-time, {fmt(current.spent)} spent, {fmt(current.roundUps)} round-ups
          </Text>
          {current.last !== null && <Text dimColor>Last turn dropped in {fmt(current.last.tokens)}</Text>}
        </Box>

        {Progress ? (
          <Progress
            label={bar.label}
            value={bar.value}
            max={bar.max}
            valueText={bar.isReached ? 'enough saved!' : `${fmt(bar.value)} of ${fmt(bar.max)}`}
            color={PINK}
          />
        ) : (
          <Box flexDirection="column">
            <Text color={PINK}>{textGauge(fill)}</Text>
            <Text dimColor>
              {bar.label}: {bar.isReached ? 'enough saved!' : `${fmt(bar.value)} of ${fmt(bar.max)}`}
            </Text>
          </Box>
        )}

        <Button
          key="ask"
          variant="primary"
          label="Ask Claude what to buy"
          onPress={() => askSoon($)}
        />

        <Box flexDirection="column">
          <Text bold>Treats</Text>
          {current.treats.length === 0 && <Text dimColor>Nothing bought yet.</Text>}
          {current.treats.slice(0, 8).map(treat => (
            <Text>
              {fmt(treat.tokens)} on {treat.on}
              {treat.isGoal ? ', saved up for' : ''} ({dayLabel(treat.at)})
            </Text>
          ))}
        </Box>

        <Text dimColor>
          Each turn's output is rounded up to the next {STEP} tokens and the change is counted here. Saving is a tally
          and costs nothing; a treat is real tokens Claude writes.
        </Text>
      </Box>
    )
  })
}
