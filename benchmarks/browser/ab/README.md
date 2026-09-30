# Interleaved A/B for a single change

Measurements taken in separate navigations **are not comparable**. In the session in
which this tool was built, the same code gave `create 10k` = 40 ms and, ten
minutes later, 106 ms — the machine load changed, not the code. An A/B
comparison done that way reported a 29% gain where the correct measurement
shows 0%.

Here both variants are separate bundles loaded into the **same page** and
measured alternately, with rotation between rounds. The noise falls on both at once, and
the estimator is the **minimum** (noise only adds time, never subtracts it).

## Usage

The variants must sit **next to** the file they replace, so their relative
imports resolve:

```bash
cp <old-variant> packages/dom/src/__ab-a.ts
cp <new-variant>  packages/dom/src/__ab-b.ts
cd benchmarks
node browser/ab/build.ts ../packages/dom/src/__ab-a.ts ../packages/dom/src/__ab-b.ts
node browser/serve.ts        # then open /ab/index.html and click "Run"
rm ../packages/dom/src/__ab-a.ts ../packages/dom/src/__ab-b.ts
```

The build swaps only `packages/dom/src/control.ts` (where `For` lives), via a
resolution plugin; the rest of the graph stays identical, so the difference between
bundles is exactly the change under test.

## How to read it

Run it **at least three times**. A gain is real only if it shows up with the same
sign across all runs. Differences below the measurement resolution (here ~0.1 ms) mean
nothing: on a 1.4 ms operation, that's already 7%.
