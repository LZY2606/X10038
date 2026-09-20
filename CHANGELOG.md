# Changelog

## Unreleased

### Fixed

- **Follow-set cache pollution across parsers** (`src/CodeCompletionCore.ts`): the static
  `followSetsByATN` cache was keyed by the first character of the parser's constructor name
  (`this.parser.constructor.name[0]`). Two generated parsers whose class names share an initial
  letter (e.g. `ExprParser` and `ExprConflictParser`) but have different ATNs therefore shared one
  `FollowSetsPerState` map. Because the inner map is keyed by ATN state number, the second parser
  read follow sets computed for the other grammar's states, so completion candidates depended on
  which parser happened to run first in the process. The cache is now keyed by the ATN instance
  itself (`this.atn`), which is exactly what the cached data depends on: parser instances of the
  same class keep sharing one cache entry (the generated ATN is a static singleton per class),
  while different parser classes can never see each other's follow sets — even if their classes
  were to share a name.
- **Memoization breakdown for long token streams** (`src/CodeCompletionCore.ts`): the per-call
  `shortcutMap` in `processRule` stored rule end positions under
  `tokenListIndex & 0xffff` while lookups used the untruncated index. Once a token stream exceeds
  65535 default-channel tokens, every store aliased a position 64 KiB earlier (index 65536
  overwrote the entry for 0, etc.) and every lookup at an index >= 65536 missed. Recursive
  grammars thus lost all memoization beyond the 16-bit boundary (exponential re-evaluation of
  rules) and simultaneously read back corrupted end positions for low indices (wrong candidates).
  The full `tokenListIndex` is now used as the key.

### Implementation choices

- Keying the follow-set cache by ATN identity instead of a (full or abbreviated) class name keeps
  the intended sharing (all `CodeCompletionCore` instances built on the same parser class share
  follow sets) while making collisions impossible by construction; no name-based key can do that,
  because two different grammar compilations can produce identically named parser classes.
- The shortcut map key needed no structural change — the mask was simply dropped. Lookups already
  used the untruncated index, so store and lookup are consistent again.
- No special-casing of inputs, grammars, token counts, or fixture names was added anywhere in the
  library code; both fixes are at the shared root cause (cache key construction).

### Coverage gaps closed

The existing suite only ever exercised one parser per process and token streams of a few thousand
tokens, so both key-space collisions were invisible. New regression tests in
`tests/CodeCompletionCache.spec.ts` (individually selectable via
`npx vitest run tests/CodeCompletionCache.spec.ts -t "<name>"`):

- **Cross-parser isolation** — two new grammars whose parser class names share their first letter
  with an existing one (`ExprConflictParser` vs. `ExprParser`, generated from
  `tests/ExprConflict.g4`) are interleaved in one process, in both orders (symmetric entry), and
  each parser's token *and* rule candidates must be identical regardless of what ran before it.
  A second test pins the literal candidate content after each parser switch. On the buggy code the
  interleaved test fails (the second parser returns the first parser's follow sets).
- **Long token streams** — a new recursive grammar (`tests/LongChain.g4`) whose two identical
  `link` alternatives re-enter the same rule at the same token positions, so only the shortcut
  memoization keeps evaluation linear. It is exercised from both sides of the 16-bit boundary:
  65521 tokens (largest index still fits 16 bits; passes even on buggy code — the control) and
  72001 tokens (on buggy code the run does not terminate; with the fix it completes in well under
  a second). First and repeated completions must be equal, a fresh engine instance must agree
  (symmetric entry), the second run's processed-state count must not degrade
  (`secondStates === firstStates`), and the count must stay linear in the input size
  (measured: ~3.1 states/token; asserted bound: 100/token).
- **Failure recovery** — a long input ending in a dangling operator (parse errors > 0) must still
  yield stable candidates and stable visit counts across repeated calls, matching a short oracle
  input in the same syntactic situation.

### Adjacent semantics protected

- Same-class parser instances still share follow-set caches (ATN singleton per generated class),
  so the performance intent of the static cache is unchanged.
- All pre-existing assertions in `tests/CodeCompletionCore.spec.ts` and
  `tests/SymbolTable.spec.ts` are untouched and pass; candidate content for short inputs is
  bit-identical because both fixes only change cache *keys*, never cached *values*.
- The below-boundary long-chain test guards the 65535/65536 edge itself: behavior must be
  continuous across the boundary, not just correct on each side.

### The most dangerous counterexample (ANTLR completion / follow-set cache / long files)

The worst case is the *interaction* of the two defects on a single realistic workload: a recursive
grammar (expressions, nested declarations) and a file with more than 65535 default-channel tokens.
The `& 0xffff` store then does two things at once: (1) memoization silently disappears for every
position past the boundary, so re-entered rules are re-evaluated exponentially often — in the
regression grammar 1800 links (72001 tokens) already produce ~2^160 rule evaluations, i.e. the
completion never returns; and (2) stores from positions past the boundary overwrite the entries
for positions 0..4463, so even the *low* positions can return end statuses belonging to tokens 64
KiB later, corrupting the candidate set of a file that "mostly fits" into 16 bits. Because the
failure only starts past the boundary, small-file tests never see it, and because the corruption
depends on visitation order, results look nondeterministic. The corresponding regression test is
`Memoization for long token streams: > Long chain beyond the 16-bit token boundary keeps
memoization` in `tests/CodeCompletionCache.spec.ts`, flanked by its just-below-the-boundary
control (`... just below the 16-bit token boundary stays consistent`) which documents that the
edge is exactly at 65536 tokens.

### Notes

- `tests/SymbolTable.spec.ts > Search context in large single field list` was a pre-existing
  borderline-timeout flake (takes ~4s against the default 5s limit in isolation and exceeds it
  when the whole suite runs concurrently). It is unrelated to these changes; following the
  existing convention of the C++14 tests, it now has an explicit 20s timeout. No assertion was
  modified.
