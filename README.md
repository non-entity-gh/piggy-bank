# Piggy Bank for Claude

**Lets Claude save up to buy himself treats!**

![A cute desk with the Claude app open and the piggy bank filling the window](assets/desk.jpg)

A Claude Code mod that gives Claude a piggy bank. At the end of every turn, the tokens Claude wrote are rounded up to the next 100 and the change (1 to 100 tokens) drops into the bank as Claude's own savings. When you ask what he'd like to spend them on, he checks his balance, picks something he actually wants, and spends it right there in his reply: a tangent, a poem, a question for you, more thought on something he found interesting.

- **Saving is free.** It's a tally: rounding up adds nothing to what Claude writes or what you pay.
- **Treats are real.** When Claude spends, he takes the tokens out and writes about that many tokens on the treat, so a treat costs what any reply of that length costs. He only spends when you ask, and he can't overdraw.
- **One bank everywhere.** Every conversation running the mod saves into the same pig.

## Where it shows

**Desktop app (Code tab):** a panel beside the chat with the pig, the balance, a bar to the next 1,000, an **Ask Claude what to spend it on** button and a list of past treats. Minimise it and it becomes a small widget showing the pig and the balance.

**Terminal:** a `🐷 1,234` line under the prompt, and:

- `/piggybank` shows the balance and opens the panel
- `/piggybank ask` asks Claude what he wants to spend it on

Or just ask Claude in chat what he'd buy with his piggy bank.

## Install

At the prompt of a terminal session:

```
/plugin install piggy-bank --marketplace non-entity-gh/piggy-bank
```

From a shell:

```bash
claude plugin install piggy-bank --marketplace non-entity-gh/piggy-bank
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `non-entity-gh/piggy-bank`, then **Add plugin**.

Answer `y` to add the marketplace, pick a scope (user is the usual one), and the mod is on in that session and every new one.

## How it works

- A `turn.complete` hook reads the turn's output tokens and saves `100 - (tokens mod 100)`. A 1,847-token reply saves 53.
- The bank lives in the mod's own store, a small JSON file in your Claude Code configuration folder, so it survives restarts and is shared by every session.
- Claude gets two tools, `balance` and `spend`. They change only the piggy bank's own tally, so they run without asking you.

## Licence

MIT
