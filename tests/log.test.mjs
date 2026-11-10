import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, answersMatch, tidy, usable, variants, samplesMatching } from "../js/log.js";
import { pickGame, QUESTIONS, BONUS_QUESTIONS } from "../js/questions.js";

test("round 1 prompt ends on the model's answer line and hides your guess", () => {
  const p = buildPrompt([], { kind: "model", q: "What's your favorite season?" });
  assert.ok(p.endsWith("Question 1: What's your favorite season?\nPlayer B's answer:"));
});

test("round 2 prompt includes earlier turns and ends on your answer line", () => {
  const history = [
    { kind: "model", q: "Q one?", b: "Tacos", a: "Pizza" },
    { kind: "player", q: "Q two?", a: "Blue" },
  ];
  const p = buildPrompt(history, { kind: "player", q: "Q three?", bonus: true });
  assert.ok(p.includes("Question 1: Q one?\nPlayer B's answer: Tacos\nPlayer A's guess: Pizza\n"));
  assert.ok(p.includes("Question 2: Q two?\nPlayer A's answer: Blue\n"));
  assert.ok(p.endsWith("Question 3 (bonus): Q three?\nPlayer A's answer:"));
});

test("answersMatch is forgiving about case, articles, plurals and modifiers", () => {
  assert.ok(answersMatch("Pizza", "pizza"));
  assert.ok(answersMatch("a dog", "Dogs"));
  assert.ok(answersMatch("Fall", "fall."));
  assert.ok(answersMatch("pepperoni pizza", "Pizza"));
  assert.ok(!answersMatch("Summer", "Winter"));
  assert.ok(!answersMatch("", "Winter"));
});

test("tidy and usable clean model samples", () => {
  assert.equal(tidy(' "Sleeping in."'), "Sleeping in");
  assert.equal(tidy(" Tacos, burritos and more"), "Tacos");
  assert.ok(usable(" Fall"));
  assert.ok(!usable("   "));
  assert.ok(!usable("I really think that the answer would have to be summer"));
});

test("variants cover capitalisations without duplicates", () => {
  assert.deepEqual(variants("ice cream"), ["ice cream", "Ice cream", "Ice Cream"]);
});

test("samplesMatching counts matching samples", () => {
  assert.equal(samplesMatching([" Fall", " fall", " Summer", ""], "Fall"), 2);
});

test("pickGame gives 3 + 3 different questions and a bonus", () => {
  const g = pickGame();
  const all = [...g.round1, ...g.round2];
  assert.equal(new Set(all).size, 6);
  all.forEach((q) => assert.ok(QUESTIONS.includes(q)));
  assert.ok(BONUS_QUESTIONS.includes(g.bonus));
});

test("everyday synonyms seen in real games match", () => {
  assert.ok(answersMatch("Fall", "Autumn"));
  assert.ok(answersMatch("Mac and cheese", "Macaroni and cheese"));
  assert.ok(answersMatch("Flying", "Flight"));
  assert.ok(answersMatch("The rain", "Rain"));
  assert.ok(!answersMatch("Rain", "Crickets"));
});
