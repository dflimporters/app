# DFL Trivia — Build Spec (Round 1)

Hosted on dflhq.com, same stack as the DFL World Cup Predictions page: static HTML/JS on GitHub Pages, Supabase backend (project hzagwndglwhcepsirafi), anon-key REST + RPC calls from the client.

## Timing
- **Round 1 window: Friday, September 4, 9:00am–10:00am (Jamaica time, UTC-5)**


## Format & rules
- Event-day, not open-ended: each round has a tight `opens_at`/`closes_at` window (a few hours, one specific day).
- Casual name entry — same fuzzy-match "is this you?" flow as the predictions page, checked against existing `trivia_responses.player_name` values. No SSO.
- One question at a time, forward-only — no back button, server decides what's "next."
- **Fully silent scoring** — no right/wrong feedback per question, during or immediately after answering. This is deliberate, to discourage players from telling each other answers mid-round.
- **Live leaderboard during the round** — aggregate score + questions-answered count only. This is safe alongside silent per-question feedback because a running total doesn't reveal which specific question someone got right or wrong.
- Full reveal (correct answers, per-question breakdown, final leaderboard) only after `closes_at`.
- Built for repeat rounds — adding Round 2, 3, etc. later should be a data insert, not a code change.

## Visual/UX
Reuse the World Cup Predictions shell wholesale: navy (`#0f2044`) sticky header, Inter font, card-based layout, same name-entry screen and match logic. Swap match cards for a single question card (question text + 4 option buttons A–D), with a "Question X of 10" progress indicator instead of team flags/scores.

## Data model
```sql
trivia_rounds (
  id, round_number, title, opens_at, closes_at
)

trivia_questions (
  id, round_id, question_text,
  option_a, option_b, option_c, option_d,
  correct_option,      -- 'a' | 'b' | 'c' | 'd'
  order_index
)

trivia_responses (
  id, round_id, question_id, player_name,
  selected_option, is_correct, answered_at
)
```

## Security — the important part
Trivia answers are known in advance (unlike football results), so if `correct_option` or `is_correct` is readable via the anon key, anyone with dev tools can see them before or during the round.

**Revoke anon SELECT on `trivia_questions` and `trivia_responses` entirely.** All access goes through `SECURITY DEFINER` Postgres functions (same pattern as `lock_due_matches` on the predictions page — no new Edge Function needed):

- **`get_next_question(round_id, player_name)`** → returns the next question this player hasn't answered yet (text + options, never `correct_option`). Returns null if the round isn't open or they've answered everything.
- **`submit_answer(round_id, question_id, player_name, selected_option)`** → validates the round is currently open and this question hasn't already been answered by this player, inserts the response with server-computed `is_correct`, returns only an ack (e.g. questions-answered count). Never reveals correctness.
- **`get_leaderboard(round_id)`** → returns `player_name, correct_count, questions_answered, last_answered_at` per player. No `selected_option` or per-question detail — safe to call anytime, including mid-round.
- **`get_round_results(round_id)`** → only returns real data once `now() > closes_at`; gives full correct answers + each player's per-question breakdown for the reveal screen.

## Player flow
1. Name entry (fuzzy match, reused from predictions).
2. Screen state depends on time vs. the round window:
   - **Before `opens_at`:** "Round 1 opens Friday Sept 4 at 9:00am."
   - **During window:** current question card → Submit advances to the next one. No back button, no feedback shown.
   - **After finishing all questions, window still open:** "You're in — leaderboard updates live, results after 10:00am." Leaderboard tab available.
   - **After `closes_at`:** results screen — correct answers, the player's own right/wrong breakdown, final leaderboard.

## Leaderboard tab
- Sorted by `correct_count`, shared rank on ties (reuse the medal/tie-handling logic already in the predictions page's Sniper Leaders table) — no speed tiebreak.
- Same tab works live during the round and as the final result after close.

## Multi-round support
- Site auto-detects the "current" round from `opens_at`/`closes_at` (the active one, or the most recently closed one if none is active).
- A cumulative across-rounds leaderboard tab is worth adding once Round 2 exists.
- New rounds = insert rows into `trivia_rounds` + `trivia_questions`. No code changes needed.

## Round 1 content
*(Answer key TBD — mark `correct_option` for each before seeding.)*

1. In what year did DFL's journey begin? A. 1965 B. 1970 C. 1976 D. 1985
  1976 Correct
2. What was DFL originally started as? A. A grocery store B. A livestock farm C. A restaurant D. A food import company
  Livestock farm correct
3. What did DFL's farm become known for producing? A. Beef B. Chicken C. Eggs D. Milk
  Eggs correct
4. In what year did DFL expand into the distributorship business? A. 1985 B. 1990 C. 1995 D. 2000
  1995 Correct
5. Which of the following does DFL supply? A. Supermarkets B. Hotels C. Restaurants D. All of the above
  All of the above - correct
6. How many parishes does DFL provide island-wide delivery across? A. 10 B. 12 C. 14 D. 16
  14 correct
7. Approximately how much storage space does DFL have? A. 10,000 sq. ft. B. 25,000 sq. ft. C. 50,000+ sq. ft. D. 100,000 sq. ft.
  50,000 sq.ft - Correct
8. Approximately how many products does DFL have available? A. 500+ B. 750+ C. 1,000+ D. 5,000+
  1,000+ Correct
9. Approximately how many satisfied clients does DFL list on its website? A. 500+ B. 1,000+ C. 2,000+ D. 5,000+
  2,000+ - Correct
10. What does DFL's tagline/culture phrase say? A. The Company That Delivers B. The Team That Cares C. The Company That Leads D. The Team That Wins
  The Team That Cares - Correct
