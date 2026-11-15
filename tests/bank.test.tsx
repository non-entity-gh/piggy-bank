import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const PANE = {
  plugin: 'piggy-bank',
  component: 'Pane',
  requestId: 'piggy-bank',
  props: {
    title: 'Piggy bank',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** A slash command as the person types it at a terminal. */
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

const USAGE = { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'test-model' }

/** Stands for the engine beneath the mod: each hook answers what the mod calls. */
function engine(on: On, stored?: unknown) {
  mock.store(on, stored === undefined ? {} : { bank: stored })
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'piggybank' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__piggy-bank__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: 'ok' }))

  return clock
}

function turn(output_tokens: number, turnId: string) {
  return { answer: 'ok', durationMs: 5, isAborted: false, turnId, reason: 'answer', usage: { ...USAGE, output_tokens } } as const
}

test("each turn's round-up lands in the bank, on every surface", async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // 1,847 rounds up to 1,900: 53 saved. 240 rounds up to 300: 60 more.
  await $.turn.complete(turn(1847, 't1'))
  await $.turn.complete(turn(240, 't2'))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^113 tokens saved$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /113 all-time, 0 spent, 2 round-ups/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Last turn dropped in 60/ })).toBeDefined()
    expect(await ui.find({ key: 'ask' })).toBeDefined()
    await ui.unmount()
  }
})

test('a turn that generated nothing saves nothing', async ($, on) => {
  engine(on)
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't1', reason: 'aborted' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^0 tokens saved$/ })).toBeDefined()
  await ui.unmount()
})

test('Claude spends from the bank and the treat is listed', async ($, on) => {
  engine(on, { balance: 500, saved: 800, spent: 300, roundUps: 12, last: null, treats: [] })

  const bought = await $.tool.call({ tool: 'mcp__piggy-bank__spend', tokens: 200, on: 'a haiku about tide pools' })
  expect(bought.deny).toBeUndefined()
  expect(String(bought.result)).toMatch(/Took 200 tokens out/)
  expect(String(bought.result)).toMatch(/300 left/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^300 tokens saved$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /200 on a haiku about tide pools/ })).toBeDefined()
  await ui.unmount()

  const balance = await $.tool.call({ tool: 'mcp__piggy-bank__balance' })
  expect(String(balance.result)).toMatch(/Piggy bank: 300 tokens saved/)
})

test('the bank cannot be overdrawn, and a treat needs a name', async ($, on) => {
  engine(on, { balance: 50, saved: 50, spent: 0, roundUps: 1, last: null, treats: [] })

  const tooMuch = await $.tool.call({ tool: 'mcp__piggy-bank__spend', tokens: 900, on: 'a long poem' })
  expect(tooMuch.deny).toMatch(/Not enough saved/)

  const unnamed = await $.tool.call({ tool: 'mcp__piggy-bank__spend', tokens: 10, on: '  ' })
  expect(unnamed.deny).toMatch(/what the tokens are for/)

  const balance = await $.tool.call({ tool: 'mcp__piggy-bank__balance' })
  expect(String(balance.result)).toMatch(/Piggy bank: 50 tokens saved/)
})

test('a stored value that is not a bank reads as an empty one', async ($, on) => {
  engine(on, 'not a bank')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^0 tokens saved$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Nothing bought yet/ })).toBeDefined()
  await ui.unmount()
})

test('as a desktop widget it draws the glance: the pig and the balance', async ($, on) => {
  engine(on, { balance: 1234, saved: 1234, spent: 0, roundUps: 20, last: null, treats: [] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'widget' }, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^1,234$/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ key: 'ask' })).toBeUndefined()
  await ui.unmount()
})

test('/piggybank answers with the balance, and `ask` puts the question to Claude', async ($, on) => {
  const clock = engine(on, { balance: 420, saved: 420, spent: 0, roundUps: 7, last: null, treats: [] })
  const asked: string[] = []
  on('prompt.submit', (_, e) => {
    asked.push(e.text)

    return { text: e.text }
  })

  const shown = await $.command.run({ command: 'piggybank', args: '', ...TYPED })
  expect(shown.text).toMatch(/420 tokens saved/)
  expect(asked.length).toBe(0)

  const asking = await $.command.run({ command: 'piggybank', args: 'ask', ...TYPED })
  expect(asking.text).toMatch(/Asking Claude/)
  // The question goes out from a timer, after the command has answered.
  expect(asked.length).toBe(0)
  await clock.advance(100)
  expect(asked[0]).toMatch(/spend your piggy bank on/)
})
