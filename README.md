# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/alberty6/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/alberty6/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in for csv-reader 1.0.0: it reads broken CSV files exactly the way the reference does (BOM, CRLF / lone CR, quoted fields with embedded newlines, doubled quotes, quote junk, unterminated quotes, short / long rows), but parses with bulk line splitting and indexOf jumps instead of character-by-character string building.

## Run it

```sh
node main.ts
```

`main.ts` reads cases from `MAKEFUN_INPUT_DIR` and writes answers to `MAKEFUN_OUTPUT_DIR`, as the harness expects. `solve.js` exports `run({ text, header })` returning `{ columns, rows, errors }`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=b8exzcer&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
