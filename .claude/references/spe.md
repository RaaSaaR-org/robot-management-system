---
owner: huhn511
---

# The size scale

Demand-loaded — read before putting a number on anything. What size *means* is policy, in [`.claude/rules/tasks.md`](../rules/tasks.md); the numbers live here and nowhere else.

| spe | Context budget                                        |
| --- | ----------------------------------------------------- |
| 1   | one file, obvious change                              |
| 2–3 | one slice, few files, the pattern exists              |
| 5   | multi-file, some discovery                            |
| 8   | **the ceiling — ~150k context.** Nothing higher ships |

**Never publish a leaf above 8.** Past it the agent degrades: forgotten instructions, invented facts. Splitting beats a failed session. The ceiling binds leaves only — a parent's roll-up may be larger.

**Size after reading the code the slice touches.** A number produced before exploration measures the guess.

Write it as `spe: <n>` in the frontmatter. An epic carries no number of its own.
