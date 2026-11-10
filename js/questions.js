// Built-in questions. Like the TV show, they are light, personal and answerable in a few words.
// Both teammates answer about themselves ("What's YOUR..."), so the same question works whichever
// way round the prediction goes.
export const QUESTIONS = [
  "What's your go-to comfort food?",
  "What's the first thing you do when you wake up?",
  "What's your favorite season?",
  "Where would you go on a free weekend?",
  "What's the best pizza topping?",
  "What animal are you most like?",
  "What's your favorite thing to do on a rainy day?",
  "What's the most annoying household chore?",
  "What do you always forget to pack?",
  "What's the best ice cream flavor?",
  "What would you buy first if you won the lottery?",
  "What's your favorite room in the house?",
  "What's the best thing to eat at the movies?",
  "What color would you paint your front door?",
  "What's the worst smell?",
  "What's the best way to spend a Sunday morning?",
  "What's the first thing you'd grab in a fire?",
  "What's one food you refuse to eat?",
  "What's your favorite sound?",
  "What would you do with an extra hour every day?",
  "What was your dream job as a kid?",
  "What's the best board game?",
  "What's your favorite holiday?",
  "What's your favorite color?",
  "What's the best fruit?",
  "What's your favorite day of the week?",
  "What's the best dessert?",
  "What do you drink most often?",
];

// The bonus question is a bigger, more open one, like the show's.
export const BONUS_QUESTIONS = [
  "If you could have any superpower, what would it be?",
  "If you could live anywhere in the world, where would it be?",
  "If you were a kitchen appliance, which one would you be?",
  "If you could master one skill overnight, what would it be?",
  "If you could be any animal for a day, what would it be?",
  "If you could visit any planet, which would it be?",
  "What's the best movie of all time?",
  "What's the best invention of all time?",
];

/** Pick a fresh game: 6 regular questions (3 per round) and 1 bonus, all different. */
export function pickGame(rand = Math.random) {
  const shuffled = [...QUESTIONS].sort(() => rand() - 0.5);
  const bonus = BONUS_QUESTIONS[Math.floor(rand() * BONUS_QUESTIONS.length)];
  return { round1: shuffled.slice(0, 3), round2: shuffled.slice(3, 6), bonus };
}
