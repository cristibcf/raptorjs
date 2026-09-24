import { state, derived, createRoot } from "../../packages/core/src/index.ts";
const WIDTH = 8, DEPTH = 10, ITER = 40000;
let setSrc!: (v: number) => void; let tails!: Array<() => number>;
createRoot(() => {
  const s = state(0); setSrc = (v) => s.set(v);
  tails = [];
  for (let w = 0; w < WIDTH; w++) {
    let node: () => number = derived(() => s() + w);
    for (let d = 1; d < DEPTH; d++) { const p = node; node = derived(() => p() + 1); }
    tails.push(node);
  }
});
let acc = 0;
for (let i = 0; i < 2000; i++) { setSrc(i); for (const t of tails) acc += t(); }
const start = performance.now();
for (let i = 0; i < ITER; i++) { setSrc(i); for (const t of tails) acc += t(); }
console.log("ms", (performance.now() - start).toFixed(1), "acc", acc);
