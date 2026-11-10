# Same Page

**▶ Play: https://charlieamis.github.io/same-page/**

A cooperative, newlywed-style game show for **you and a base language model**. You're a team: you score
points every time one of you correctly predicts what the other said. Round 1, you predict the model. Round 2,
the model predicts you.

Built on the [ACS Infra base-model API](https://docs.v2.infra.acsresearch.org/docs). It is an homage to classic TV
newlywed game shows and is not affiliated with any of them.

---

## Rules (kept close to the original show)

The classic show had couples score points by matching each other's answers: one partner went offstage, the other
predicted their answers, then they compared cards. We keep that structure and point values:

| | Who predicts whom | Questions | Points |
|---|---|---|---|
| **Round 1** | You predict the model. It answers "offstage" (sealed) first. | 3 | 5 each |
| **Round 2** | The model predicts you. It seals its guess, then you give your real answer. | 3 | 10 each |
| **Bonus** | The model predicts you. | 1 | 25 |

A perfect game is **70 points**. Questions are drawn at random from a built-in list each game.

**Changes from the show, and why:**

- **One couple, not four.** There's no other team to beat, so it's purely cooperative: you're playing for your own
  score out of 70. (The show's prize for the top couple is gone.)
- **The host's call.** The game matches answers automatically and generously ("a dog" = "Dogs",
  "pepperoni pizza" = "Pizza"). If it misses a match a human host would allow, press **Host's call: count it**. It's
  an honor system, like the show.
- **Sources disagree on the bonus value** (25 or 35 points in different eras). We use 25, which gives the 70-point
  maximum most sources describe.

---

## How it works

### The page the model reads

A base model just continues text. The whole game is one growing document: a log of a prediction game between
**Player A** (you) and **Player B** (the model's line). One finished example game sets the format, then your game
is logged as it happens:

```
=== Game 42 ===
Question 1: What's your favorite season?
Player B's answer: Fall          <- round 1: the model writes this line
Player A's guess: Summer         <- your guess, added after the reveal
...
Question 4: What's the best pizza topping?
Player A's answer:               <- round 2: the model writes YOUR line, which is its prediction of you
```

- **Round 1:** the model writes Player B's answer. Your guess is never on the page before it answers.
- **Round 2:** the model writes Player A's answer, using everything you've written earlier in the log (your
  round 1 guesses and earlier answers). That's its prediction of you. It gets more to go on with every question.

Press **See the page the model reads** in the game to see the exact text.

### Each turn = two API calls

1. **Sample:** `n: 10, temperature: 1, max_tokens: 12, stop: ["\n"]`. The first usable sample is the model's
   sealed answer or guess. The others are shown after the reveal ("everything it wrote on its line"), with a count
   of how many matched you.
2. **Score your words:** `echo: true, logprobs: 10, max_tokens: 1` on `prompt + " " + your text + "\n"`. Adding the
   answer's token log-probabilities gives the model's probability for your exact words. The trailing line break
   counts as "end of answer", so "pizza" doesn't get credit for "pizza with olives". A few capitalisations are
   summed, since "Pizza" and "pizza" are different strings to the model.

Press **Show me this in the API** to see the request bodies, ready for `curl`.

### Matching answers

`js/cluster.js` is shared with [Sample Says](https://github.com/charlieamis/sample-says): lowercase, drop
punctuation and filler words (*a, the, my*), plurals to singular, "-ing" to base form, a few everyday synonyms,
one-letter typos in long words, and "same thing plus a describing word" (*beach towel* = *towel*). It's
rule-based, so it won't catch meaning-level matches (*sofa* vs *couch*); that's what the host's call is for.

### Honest caveats

- The model isn't a person and has no favorite season. Its "answer" is the text it predicts for Player B's line.
  In round 2 it's predicting what *you* would type, from what's on the page.
- One sample is luck as well as skill. The percentages show how likely each answer was, without that luck.
- `llama-8b` is the default and always warm. `llama-405b` and `trinity-truebase` scale to zero when idle; the
  first question wakes them (can take minutes) and the sealed card shows progress.

---

## Playing

1. Paste an ACS API key (`sk-acs-…`, from [v2.infra.acsresearch.org](https://v2.infra.acsresearch.org)). Old
   `acs-bm-` keys don't work. Tip: make a separate key with a low daily budget for this game.
2. Pick your partner model and press **Start the game**.

Your key stays in the browser tab (memory only, or `sessionStorage` if you tick "Remember for this tab"). It is only
sent to `api.v2.infra.acsresearch.org`, and the page's Content Security Policy blocks every other destination.

---

## Project layout

```
index.html           page structure (plus a strict Content Security Policy)
css/style.css        the look (pure CSS, no images or fonts downloaded)
js/api.js            the ONLY file that talks to the network (and holds the key)
js/log.js            the game log prompt, sampling, logprob scoring, answer matching
js/cluster.js        normalising + matching answers (shared with Sample Says)
js/questions.js      the built-in questions
js/game.js           UI: rounds, sealed cards, reveal, score, sounds
tests/               unit tests (node --test)
scripts/check-secrets.mjs   secret scanner used by the pre-commit hook and CI
.githooks/pre-commit        runs the scanner before every commit
.github/workflows/deploy.yml  CI: secret scans + tests, then deploy to GitHub Pages
```

No build step: the files in the repo are the website. Push to `main` and GitHub Actions runs the checks and
publishes to GitHub Pages (about a minute). Try it locally with `python -m http.server 8125`, run tests with
`node --test tests/*.test.mjs`. After a fresh clone, turn on the secret-scanning hook with
`git config core.hooksPath .githooks`.

If a key ever does get pushed: **revoke it on the ACS API keys page first** (the repo is public), then remove it.
