// UI controller. Network calls live in api.js; the game log, sampling and scoring in log.js.
import * as api from "./api.js";
import { buildPrompt, sampleTurn, scoreText, answersMatch, samplesMatching, SAMPLES_PER_TURN } from "./log.js";
import { pickGame } from "./questions.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const COLD_MODELS = new Set(["llama-405b", "trinity-truebase"]);
const MAX_SCORE = 70;

let game = null;
let sound = true;
const modelWarm = {}; // id -> boolean (best guess)

/* ---------------- Setup: key + models ---------------- */

function refreshKeyStatus() {
  const s = $("key-status");
  if (api.hasKey()) {
    s.textContent = `Using key ${api.keyHint()}${api.isRemembered() ? " (remembered for this tab)" : " (in memory only)"}. `;
    const forget = el("button", "btn ghost small", "Forget key");
    forget.type = "button";
    forget.addEventListener("click", () => {
      api.clearKey();
      $("key-remember").checked = false;
      refreshKeyStatus();
    });
    s.append(forget);
  } else {
    s.textContent = "No key yet. You need an approved ACS Infra account; create a key at v2.infra.acsresearch.org (API Keys).";
  }
  $("start-btn").disabled = !api.hasKey();
}

$("key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("key-input");
  if (!input.value.trim()) return;
  api.setKey(input.value, { remember: $("key-remember").checked });
  input.value = ""; // don't leave the key sitting in the DOM
  refreshKeyStatus();
  await loadModels();
});

async function loadModels() {
  const sel = $("model-select");
  const status = $("model-status");
  status.textContent = "Checking which models are live…";
  try {
    const models = await api.listModels();
    const current = sel.value || "llama-8b";
    sel.replaceChildren();
    const ids = models.map((m) => m.id);
    if (!ids.includes("llama-8b")) ids.unshift("llama-8b");
    for (const id of ids) {
      const o = el("option", null, id + (COLD_MODELS.has(id) ? " (may need to warm up)" : ""));
      o.value = id;
      sel.append(o);
    }
    sel.value = ids.includes(current) ? current : "llama-8b";
    sel.disabled = false;
    status.textContent = "";
    checkWarm(sel.value);
  } catch (err) {
    status.textContent = err.message;
    if (err.code && /key|auth|scope|approved/.test(err.code)) {
      api.clearKey();
      refreshKeyStatus();
      $("key-status").textContent = err.message;
    }
  }
}

$("model-select").addEventListener("change", (e) => checkWarm(e.target.value));

async function checkWarm(id) {
  const status = $("model-status");
  if (!COLD_MODELS.has(id)) {
    modelWarm[id] = true;
    status.textContent = "✅ always warm";
    return;
  }
  status.textContent = "Checking if it's awake…";
  try {
    const s = await api.modelStatus(id);
    modelWarm[id] = !!s.warm;
    status.textContent = s.warm ? "✅ warm and ready" : "💤 asleep: the first question will wake it, which can take several minutes.";
  } catch {
    status.textContent = "";
  }
}

/* ---------------- Game flow ---------------- */

$("start-btn").addEventListener("click", () => startGame());

function startGame() {
  if (!api.hasKey()) return;
  const { round1, round2, bonus } = pickGame();
  const turns = [
    ...round1.map((q) => ({ kind: "model", q, points: 5, round: 1 })),
    ...round2.map((q) => ({ kind: "player", q, points: 10, round: 2 })),
    { kind: "player", q: bonus, points: 25, round: 2, bonus: true },
  ];
  game = { model: $("model-select").value || "llama-8b", turns, i: 0, history: [], score: 0, results: [] };
  $("rules").open = false;
  $("setup").hidden = true;
  $("stage").hidden = false;
  ["api-view", "prompt-view"].forEach((id) => ($(id).hidden = true));
  renderScore();
  intro(0);
}

const INTROS = {
  0: {
    title: "Round 1: you predict the model",
    body: "For each question the model writes its answer offstage and seals it. Your job: guess what it wrote. 5 points a match.",
    go: "Let's play",
  },
  3: {
    title: "Round 2: the tables turn",
    body: "Now the model predicts you. It seals its guess first, using everything you've written so far, then you give your real answer. 10 points a match.",
    go: "Bring it on",
  },
  6: {
    title: "The bonus question!",
    body: "One last question, worth 25 points. The model predicts you.",
    go: "Go for the bonus",
  },
};

function intro(i) {
  const info = INTROS[i];
  if (!info) return playTurn(i);
  setBanner(i);
  const card = el("div", "interstitial");
  card.append(el("h2", null, info.title), el("p", null, info.body));
  const go = el("button", "btn hot big", info.go);
  go.addEventListener("click", () => playTurn(i));
  card.append(go);
  $("play").replaceChildren(card);
  go.focus();
}

function setBanner(i) {
  const t = game.turns[i];
  const b = $("round-banner");
  b.className = "round-banner r" + t.round + (t.bonus ? " bonus" : "");
  b.textContent = t.bonus
    ? "Bonus question · 25 points · the model predicts you"
    : t.round === 1
      ? `Round 1 · Question ${i + 1} of 3 · 5 points · you predict the model`
      : `Round 2 · Question ${i - 2} of 3 · 10 points · the model predicts you`;
  renderPips();
}

function playTurn(i) {
  game.i = i;
  const turn = game.turns[i];
  setBanner(i);
  const prompt = buildPrompt(game.history, turn);
  game.lastPrompt = prompt;
  const modelR1 = turn.kind === "model";

  const play = $("play");
  play.replaceChildren();
  play.append(el("div", "question-card" + (turn.bonus ? " bonus" : ""), turn.q));

  const cards = el("div", "cards");
  const sealed = el("div", "card sealed");
  const sealedLabel = el("div", "card-label", modelR1 ? "The model's answer" : "The model's guess about you");
  const sealedFace = el("div", "card-face", "✍️");
  const sealedStatus = el("div", "card-status", modelR1 ? "Writing its answer offstage…" : "Predicting what you'll say…");
  sealed.append(sealedLabel, sealedFace, sealedStatus);

  const mine = el("div", "card mine");
  const form = el("form", "answer-form");
  form.autocomplete = "off";
  const label = el("label", "card-label", modelR1 ? "Your guess: what did the model write?" : "Your answer (just be yourself)");
  const input = el("input");
  input.type = "text";
  input.maxLength = 60;
  input.id = "answer-input";
  label.htmlFor = "answer-input";
  input.placeholder = "A few words…";
  const lock = el("button", "btn hot", modelR1 ? "Lock in my guess" : "Lock in my answer");
  lock.type = "submit";
  form.append(label, input, lock);
  mine.append(form);
  cards.append(mine, sealed);
  play.append(cards);
  const msg = el("p", "muted turn-msg");
  play.append(msg);
  input.focus();

  // Start the model's turn right away; it stays sealed until you lock in.
  const cold = COLD_MODELS.has(game.model) && !modelWarm[game.model];
  let stopWatch = cold ? watchWarmup(game.model, sealedStatus) : () => {};
  let pending;
  const start = () => {
    pending = sampleTurn(prompt, game.model, { cold: COLD_MODELS.has(game.model) });
    pending
      .then(() => {
        modelWarm[game.model] = true;
        sealedFace.textContent = "🔒";
        sealedStatus.textContent = modelR1 ? "Sealed. No peeking!" : "Guess sealed. Your turn!";
        sealed.classList.add("ready");
      })
      .catch((err) => showError(err))
      .finally(() => stopWatch());
  };
  const showError = (err) => {
    sealedFace.textContent = "⚠️";
    sealedStatus.textContent = err.message;
    const retry = el("button", "btn small", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => {
      retry.remove();
      sealedFace.textContent = "✍️";
      sealedStatus.textContent = "Trying again…";
      stopWatch = COLD_MODELS.has(game.model) && !modelWarm[game.model] ? watchWarmup(game.model, sealedStatus) : () => {};
      start();
    });
    sealedStatus.append(" ", retry);
  };
  start();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      msg.textContent = "Type something first: a few words is plenty.";
      return;
    }
    input.disabled = lock.disabled = true;
    msg.textContent = "Locked in.";
    let result;
    try {
      result = await pending;
    } catch {
      input.disabled = lock.disabled = false;
      msg.textContent = "The model couldn't answer. Use “Try again” on its card, then lock in.";
      return;
    }
    // The model's probability for your exact words, at the same spot in the log.
    const probPromise = scoreText(prompt, game.model, text).catch(() => null);
    await reveal(i, turn, text, result, probPromise, { cards, mine, sealed, msg });
  });
}

async function reveal(i, turn, text, result, probPromise, ui) {
  const modelR1 = turn.kind === "model";
  ui.msg.textContent = "And the model's card says…";
  playDrum();
  await wait(1200);

  const match = answersMatch(text, result.answer);
  const res = { i, turn, mine: text, theirs: result.answer, match, overridden: false, prob: null, result };
  game.results.push(res);
  game.history.push(modelR1 ? { kind: "model", q: turn.q, b: result.answer, a: text } : { kind: "player", q: turn.q, a: text, bonus: turn.bonus });

  ui.mine.replaceChildren(
    el("div", "card-label", modelR1 ? "You guessed" : "You said"),
    el("div", "card-face text", text),
  );
  ui.sealed.replaceChildren(
    el("div", "card-label", modelR1 ? "The model wrote" : "The model guessed"),
    el("div", "card-face text", result.answer),
  );
  ui.sealed.classList.add("flipped");
  ui.cards.classList.add(match ? "matched" : "missed");

  const verdict = el("div", "verdict " + (match ? "yes" : "no"));
  if (match) {
    verdict.textContent = `It's a match! +${turn.points}`;
    game.score += turn.points;
    playDing();
  } else {
    verdict.textContent = "Not a match.";
    const host = el("button", "btn small", "Host's call: count it");
    host.type = "button";
    host.title = "If you think these really mean the same thing, count it.";
    host.addEventListener("click", () => {
      res.overridden = true;
      res.match = true;
      game.score += turn.points;
      verdict.className = "verdict yes";
      verdict.textContent = `Host's call: it's a match! +${turn.points}`;
      ui.cards.classList.replace("missed", "matched");
      renderScore();
      playDing();
    });
    verdict.append(" ", host);
    playSoft();
  }
  renderScore();
  ui.msg.replaceChildren(verdict);

  const insight = el("div", "insight");
  const probLine = el("p", null, "Asking the model how likely your exact words were…");
  insight.append(probLine);
  const n = samplesMatching(result.raw, text);
  insight.append(
    el(
      "p",
      null,
      modelR1
        ? `${n} of the model's ${SAMPLES_PER_TURN} tries matched your guess.`
        : `${n} of the model's ${SAMPLES_PER_TURN} guesses about you matched what you said.`,
    ),
  );
  insight.append(el("p", "chips-label", modelR1 ? "Everything it wrote on its line:" : "All its guesses about you:"));
  const chips = el("div", "chips");
  for (const c of result.clusters.slice(0, 8)) {
    const chip = el("span", "chip" + (answersMatch(c.label, text) ? " hit" : ""), c.label);
    chip.append(el("b", null, ` ×${c.count}`));
    chips.append(chip);
  }
  insight.append(chips);
  ui.msg.after(insight);

  const next = el("button", "btn hot big next", nextLabel(i));
  next.addEventListener("click", () => (i + 1 < game.turns.length ? intro(i + 1) : finish()));
  insight.after(next);
  next.focus();

  const prob = await probPromise;
  res.prob = prob;
  probLine.replaceChildren();
  if (prob == null) {
    probLine.textContent = "(Couldn't get the model's probability this time.)";
  } else {
    probLine.append(
      modelR1 ? "The model gave your guess a " : "The model thought there was a ",
      el("strong", null, pct(prob)),
      modelR1 ? " chance of being what it wrote." : " chance you'd say exactly that.",
    );
    probLine.append(probBar(prob));
  }
}

function nextLabel(i) {
  if (i === 2) return "On to round 2 →";
  if (i === 5) return "The bonus question →";
  if (i === 6) return "See our final score →";
  return "Next question →";
}

function finish() {
  $("round-banner").className = "round-banner final";
  $("round-banner").textContent = "Final score";
  renderPips();
  const s = game.score;
  const title =
    s >= MAX_SCORE ? "Same page, same sentence, same word!" :
    s >= 45 ? "Reading each other's minds" :
    s >= 25 ? "Getting to know each other" :
    s > 0 ? "Still on the first page" : "Strangers, for now";
  const card = el("div", "interstitial final");
  card.append(el("div", "final-score", `${s}`), el("p", "of", `of ${MAX_SCORE} points`), el("h2", null, title));

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const r1 = avg(game.results.filter((r) => r.turn.round === 1 && r.prob != null).map((r) => r.prob));
  const r2 = avg(game.results.filter((r) => r.turn.round === 2 && r.prob != null).map((r) => r.prob));
  if (r1 != null || r2 != null) {
    const p = el("p", "muted");
    p.textContent =
      `How predictable you were to each other: on average the model gave your round 1 guesses ${r1 == null ? "?" : pct(r1)}, ` +
      `and your own round 2 answers ${r2 == null ? "?" : pct(r2)}.`;
    card.append(p);
  }

  const table = el("table", "recap");
  const head = el("tr");
  ["", "Question", "You", "Model", "Points"].forEach((h) => head.append(el("th", null, h)));
  table.append(head);
  for (const r of game.results) {
    const tr = el("tr", r.match ? "yes" : "no");
    tr.append(
      el("td", null, r.turn.bonus ? "★" : String(r.i + 1)),
      el("td", null, r.turn.q),
      el("td", null, r.mine),
      el("td", null, r.theirs),
      el("td", null, r.match ? `+${r.turn.points}${r.overridden ? " (host)" : ""}` : "0"),
    );
    table.append(tr);
  }
  card.append(table);
  const again = el("button", "btn hot big", "Play again (new questions)");
  again.addEventListener("click", () => startGame());
  const change = el("button", "btn", "Change model or key");
  change.addEventListener("click", () => {
    $("stage").hidden = true;
    $("setup").hidden = false;
  });
  const row = el("div", "row center");
  row.append(again, change);
  card.append(row);
  $("play").replaceChildren(card);
  if (s > 0) playFanfare();
}

/* ---------------- Score + progress ---------------- */

function renderScore() {
  $("score").textContent = String(game.score);
}

function renderPips() {
  const ol = $("pips");
  ol.replaceChildren();
  game.turns.forEach((t, k) => {
    const r = game.results.find((x) => x.i === k);
    const li = el("li", "pip" + (t.bonus ? " bonus" : "") + (r ? (r.match ? " yes" : " no") : k === game.i ? " now" : ""), t.bonus ? "★" : String(k + 1));
    li.title = `${t.points} points`;
    ol.append(li);
  });
}

function watchWarmup(model, statusEl) {
  const started = Date.now();
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const secs = Math.round((Date.now() - started) / 1000);
    let stage = "";
    try {
      const s = await api.modelStatus(model);
      if (s.warm) stage = "awake, writing now";
      else if (s.boot && s.boot.stage_label) stage = s.boot.stage_label;
    } catch {
      /* ignore */
    }
    if (stopped) return;
    statusEl.textContent =
      `Waking up ${model} (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")})` +
      (stage ? `: ${stage}` : "") +
      ". Big models sleep when idle; this can take several minutes. You can lock in meanwhile.";
    setTimeout(tick, 5000);
  };
  setTimeout(tick, 3000);
  return () => (stopped = true);
}

/* ---------------- Helpers ---------------- */

function pct(p) {
  if (!(p > 0)) return "under 0.01%";
  const v = p * 100;
  if (v >= 10) return `${v.toFixed(0)}%`;
  if (v >= 1) return `${v.toFixed(1)}%`;
  if (v >= 0.01) return `${v.toFixed(2)}%`;
  return "under 0.01%";
}

function probBar(prob) {
  const bar = el("span", "bar");
  const fill = el("span", "fill");
  fill.style.width = `${Math.max(1, Math.min(100, prob * 100))}%`;
  bar.append(fill);
  return bar;
}

/* ---------------- Transparency views ---------------- */

$("api-btn").addEventListener("click", () => toggle("api-view", "api-btn", "Show me this in the API", "Hide the API view", renderApi));
$("prompt-btn").addEventListener("click", () =>
  toggle("prompt-view", "prompt-btn", "See the page the model reads", "Hide the page", renderPrompt),
);

function toggle(id, btnId, showLabel, hideLabel, render) {
  const sec = $(id);
  if (sec.hidden) {
    render(sec);
    sec.hidden = false;
    $(btnId).textContent = hideLabel;
  } else {
    sec.hidden = true;
    $(btnId).textContent = showLabel;
  }
}

function renderApi(sec) {
  sec.replaceChildren(el("h2", null, "Show me this in the API"));
  sec.append(
    el(
      "p",
      "muted",
      `These are the last request bodies this page sent to POST ${api.BASE_URL}/completions (newest last). ` +
        "The first kind samples the model's line 10 times (n: 10). The second kind (echo: true, logprobs) " +
        "asks how likely your exact words were. Save one as request.json and run the curl command below. Your key is never shown here.",
    ),
  );
  const log = api.requestLog.filter((r) => r.path === "/completions");
  if (!log.length) sec.append(el("p", null, "No requests yet."));
  for (const r of log.slice(-2)) sec.append(el("pre", "code", JSON.stringify(r.body, null, 2)));
  sec.append(
    el(
      "pre",
      "code",
      `curl -s ${api.BASE_URL}/completions \\\n  -H "Authorization: Bearer $ACS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d @request.json`,
    ),
  );
}

function renderPrompt(sec) {
  sec.replaceChildren(el("h2", null, "The page the model reads"));
  sec.append(
    el(
      "p",
      "muted",
      "This is the exact text the model continued for the current question. You are “Player A”; the model writes the last line. " +
        "In round 1 your guess is never on the page before the model answers. Everything you write is added to the log, " +
        "which is how the model gets to know you for round 2.",
    ),
  );
  sec.append(el("pre", "code", game && game.lastPrompt ? game.lastPrompt : "(Start a game first.)"));
}

/* ---------------- Sound (synthesised, no audio files) ---------------- */

let ctx = null;
function audio() {
  if (!sound) return null;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  } catch {
    return null;
  }
}
function tone(freq, start, dur, type = "sine", vol = 0.18) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, a.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}
function playDing() {
  [784, 988, 1175].forEach((f, k) => tone(f, k * 0.09, 0.6, "triangle", 0.15));
}
function playSoft() {
  tone(392, 0, 0.35, "sine", 0.12);
  tone(330, 0.18, 0.5, "sine", 0.1);
}
function playDrum() {
  for (let k = 0; k < 9; k++) tone(120 + (k % 2) * 10, k * 0.12, 0.09, "square", 0.035);
}
function playFanfare() {
  [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, k * 0.13, 0.55, "triangle", 0.13));
}
$("sound-btn").addEventListener("click", (e) => {
  sound = !sound;
  e.currentTarget.textContent = sound ? "🔊 Sound on" : "🔇 Sound off";
  e.currentTarget.setAttribute("aria-pressed", String(sound));
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Boot ---------------- */
refreshKeyStatus();
if (api.hasKey()) {
  $("key-remember").checked = api.isRemembered();
  loadModels();
}
