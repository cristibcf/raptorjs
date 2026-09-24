/**
 * Runner principal: ruleaza DOM benchmark + signals microbenchmark, tipareste
 * tabele si scrie rezultatele in results.json si results.md.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";
import { runDomBench, type FrameworkResult } from "./bench-dom.ts";
import { runSignalBench, type SignalResult } from "./bench-signals.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..");

interface Report {
  meta: {
    date: string;
    node: string;
    platform: string;
    arch: string;
    cpu: string;
  };
  dom: FrameworkResult[];
  signals: SignalResult[];
}

function meta(): Report["meta"] {
  const cpus = os.cpus();
  return {
    date: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus[0]?.model ?? "unknown",
  };
}

// --- Formatare markdown ----------------------------------------------------
function domTable(results: FrameworkResult[]): string {
  const scenarios = results[0]!.scenarios.map((s) => s.scenario);
  const lines: string[] = [];
  lines.push("### DOM benchmark — timp median (ms), acelasi jsdom");
  lines.push("");
  lines.push(`| Scenariu | ${results.map((r) => r.framework).join(" | ")} |`);
  lines.push(`| --- | ${results.map(() => "---:").join(" | ")} |`);
  for (let i = 0; i < scenarios.length; i++) {
    const cells = results.map((r) => r.scenarios[i]!.medianMs.toFixed(2));
    lines.push(`| ${scenarios[i]} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("### Operatii DOM reale pe scenariu (create el / text / insert / remove / textUpdate)");
  lines.push("");
  lines.push(`| Scenariu | ${results.map((r) => r.framework).join(" | ")} |`);
  lines.push(`| --- | ${results.map(() => "---").join(" | ")} |`);
  for (let i = 0; i < scenarios.length; i++) {
    const cells = results.map((r) => {
      const o = r.scenarios[i]!.ops;
      return `${o.createElement}/${o.createText}/${o.insert}/${o.remove}/${o.textUpdate}`;
    });
    lines.push(`| ${scenarios[i]} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function signalTable(results: SignalResult[]): string {
  const lines: string[] = [];
  lines.push("### Signals microbenchmark — propagare pull, updates/sec (mai mult = mai bine)");
  lines.push("");
  lines.push("| Librarie | updates/sec | timp total (ms) | checksum |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const r of results) {
    lines.push(
      `| ${r.library} | ${Math.round(r.updatesPerSec).toLocaleString("en-US")} | ${r.totalMs.toFixed(1)} | ${r.checksum} |`,
    );
  }
  lines.push("");
  lines.push("> Checksum identic = graf calculat identic (verificare de corectitudine).");
  return lines.join("\n");
}

function markdownReport(report: Report): string {
  return [
    "# Rezultate benchmark RaptorJS",
    "",
    `Generat: ${report.meta.date}`,
    `Node ${report.meta.node} · ${report.meta.platform}/${report.meta.arch} · ${report.meta.cpu}`,
    "",
    "Toate framework-urile DOM randeaza in ACELASI jsdom, cu contoare de operatii",
    "DOM patch-uite pe prototipurile jsdom => comparatie apples-to-apples.",
    "",
    domTable(report.dom),
    "",
    signalTable(report.signals),
    "",
    "## Cum se citesc rezultatele",
    "",
    "- **updateAll**: toate framework-urile fac acelasi numar de mutatii DOM (textUpdate),",
    "  dar RaptorJS/fine-grained evita reconcilierea VDOM => timp mult mai mic la aceleasi mutatii.",
    "- **update every 10th**: RaptorJS scaleaza cu randurile *schimbate*; VDOM scaleaza cu",
    "  *totalul* randurilor (diff peste toata lista) => diferenta creste cu marimea listei.",
    "- **create/clear**: dominate de crearea/stergerea nodurilor; toate sunt in aceeasi clasa.",
    "- **signals**: RaptorJS vs o librarie de signals matura de productie (@preact/signals-core).",
    "",
  ].join("\n");
}

// --- Rulare ----------------------------------------------------------------
console.log("Rulez DOM benchmark (RaptorJS / React 19 / Preact 10 in acelasi jsdom)...");
const dom = runDomBench();
console.log("Rulez signals microbenchmark (RaptorJS / @preact/signals-core)...");
const signals = runSignalBench();

const report: Report = { meta: meta(), dom, signals };

// Consola.
console.log("");
console.log(markdownReport(report));

// Fisiere.
writeFileSync(join(outDir, "results.json"), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, "results.md"), markdownReport(report) + "\n");
console.log(`\nScris: benchmarks/results.json si benchmarks/results.md`);
