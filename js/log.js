// The game log: the text document the base model continues, plus sampling and scoring.
// All network calls go through api.js.
//
// A base model just continues text, so the whole game is one growing document: a log of a
// prediction game between "Player A" (you) and "Player B" (the model's line).
//   - Round 1: the model writes Player B's answer; you guess what it wrote.
//   - Round 2: the model writes Player A's answer, which is its prediction of what YOU will say,
//     based on everything you've written earlier in the log.
// The model never "plays as itself": it predicts the next line of this page.
import { complete } from "./api.js";
import { cleanSurface, normalizeWords, clusterAnswers, matchGuess } from "./cluster.js";

export const SAMPLES_PER_TURN = 10; // one request: the first usable sample is "the" answer
const MAX_TOKENS = 12;

const HEADER =
  "SAME PAGE: GAME LOG\n" +
  "Two teammates try to predict each other. In round one, Player B answers each question and Player A " +
  "guesses what B wrote. In round two, Player A answers and Player B guesses. Every answer is short: " +
  "a few words, no explanation.\n\n";

// One finished example game. It shows the FORMAT (short plain answers, both line types) on
// questions that are not in the game's question bank.
const EXAMPLE = [
  { kind: "model", q: "What's the best topping for popcorn?", b: "Butter", a: "Caramel" },
  { kind: "model", q: "What's your favorite kind of weather?", b: "Sunny", a: "Sunny" },
  { kind: "model", q: "What's the best thing about weekends?", b: "Sleeping in", a: "No work" },
  { kind: "player", q: "What would you name a pet turtle?", a: "Speedy" },
  { kind: "player", q: "What's your favorite breakfast?", a: "Pancakes" },
  { kind: "player", q: "What do you collect?", a: "Coffee mugs" },
  { kind: "player", q: "If you could time travel, where would you go?", a: "Ancient Egypt", bonus: true },
];

function entryText(e, n) {
  const label = e.bonus ? `Question ${n} (bonus)` : `Question ${n}`;
  let t = `${label}: ${e.q}\n`;
  if (e.kind === "model") t += `Player B's answer: ${e.b}\n` + (e.a != null ? `Player A's guess: ${e.a}\n` : "");
  else t += `Player A's answer: ${e.a}\n`;
  return t;
}

/**
 * The prompt for the current turn.
 * @param {Array} history finished turns of this game, in order
 * @param {{kind:"model"|"player", q:string, bonus?:boolean}} turn
 *   kind "model": the model writes Player B's answer (round 1)
 *   kind "player": the model writes Player A's answer, i.e. predicts you (round 2)
 */
export function buildPrompt(history, turn) {
  let text = HEADER + "=== Game 41 ===\n";
  EXAMPLE.forEach((e, i) => (text += entryText(e, i + 1)));
  text += "\n=== Game 42 ===\n";
  history.forEach((e, i) => (text += entryText(e, i + 1)));
  const n = history.length + 1;
  text += `${turn.bonus ? `Question ${n} (bonus)` : `Question ${n}`}: ${turn.q.trim().replace(/\s+/g, " ")}\n`;
  text += turn.kind === "model" ? "Player B's answer:" : "Player A's answer:";
  return text;
}

/** Is this a short, real answer (1–6 words after clean-up)? */
export function usable(raw) {
  const w = normalizeWords(raw || "");
  return w.length > 0 && w.length <= 6;
}

/** Tidy a sample for display: first item only, no quotes or trailing full stop. */
export function tidy(raw) {
  return cleanSurface(raw || "").replace(/[.!]+$/, "").trim();
}

/** Do two answers count as the same, using the forgiving rules from cluster.js? */
export function answersMatch(a, b) {
  if (!usable(a) || !usable(b)) return false;
  const { clusters } = clusterAnswers([a]);
  if (matchGuess(b, clusters) >= 0) return true;
  return matchGuess(a, clusterAnswers([b]).clusters) >= 0;
}

/**
 * Sample the model's line for this turn. Returns the answer (first usable sample) plus all samples,
 * grouped, so the UI can show "what else it might have written".
 */
export async function sampleTurn(prompt, model, { cold = false } = {}) {
  const res = await complete(
    { model, prompt, n: SAMPLES_PER_TURN, max_tokens: MAX_TOKENS, temperature: 1, stop: ["\n"] },
    { cold },
  );
  const raw = res.choices.map((c) => c.text);
  const firstUsable = raw.findIndex(usable);
  const answer = firstUsable >= 0 ? tidy(raw[firstUsable]) : tidy(raw[0]) || "(no answer)";
  const { clusters } = clusterAnswers(raw);
  return { answer, raw, clusters, servedModel: res.model };
}

/** How many of the samples match a given answer. */
export function samplesMatching(raw, text) {
  return raw.filter((r) => usable(r) && answersMatch(r, text)).length;
}

/** Wordings to score: "Pizza" and "pizza" are different strings to the model. */
export function variants(text) {
  const s = tidy(text);
  if (!s) return [];
  const lower = s.toLowerCase();
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
  const title = lower.replace(/\b([a-z])/g, (m) => m.toUpperCase());
  return [...new Set([s, cap, lower, title])].slice(0, 4);
}

/**
 * The model's probability of writing exactly `text` (then ending the line) at the end of `prompt`.
 * We send prompt + " " + text + "\n" with echo + logprobs and add up the answer's token logprobs.
 * The final line break is what stops "pizza" getting credit for "pizza with pineapple".
 */
export async function scoreText(prompt, model, text) {
  const vs = variants(text);
  if (!vs.length) return 0;
  const res = await complete({
    model,
    prompt: vs.map((v) => `${prompt} ${v}\n`),
    max_tokens: 1,
    temperature: 1,
    echo: true,
    logprobs: 10,
  });
  return res.choices.reduce((sum, c) => sum + scoreChoice(c, prompt.length), 0);
}

function scoreChoice(choice, answerStart) {
  const lp = choice.logprobs;
  if (!lp) return 0;
  const tokens = lp.tokens;
  const bosLen = tokens[0] && tokens[0].startsWith("<|") ? tokens[0].length : 0;
  const last = tokens.length - 2; // the final prompt token (the newline); the very last is the generated one
  let first = -1;
  for (let i = 1; i <= last; i++) {
    const start = lp.text_offset[i] - bosLen;
    if (start + tokens[i].length > answerStart) {
      first = i;
      break;
    }
  }
  if (first < 0) return 0;
  let logprob = 0;
  for (let i = first; i < last; i++) logprob += lp.token_logprobs[i];
  // End of answer: any line-break token ("\n", "\n\n", " \n", ".\n") means "the answer ended here".
  const top = lp.top_logprobs[last] || {};
  let endProb = 0;
  for (const [tok, l] of Object.entries(top)) if (/^[ .!]*\n/.test(tok)) endProb += Math.exp(l);
  if (!tokens[last].startsWith("\n") || !(endProb > 0)) endProb = Math.exp(lp.token_logprobs[last]);
  return Math.exp(logprob + Math.log(endProb));
}
