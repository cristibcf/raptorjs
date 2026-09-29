/**
 * `raptor-runtime trace` (spec sectiunea 4): scrie date de urmarire compatibile
 * OpenTelemetry si timpii cererilor.
 *
 * Formatul de iesire urmeaza structura OTLP/JSON (resourceSpans -> scopeSpans ->
 * spans), ca sa poata fi trimis unui colector existent fara conversie. Nu
 * importam nicio biblioteca: scriem forma documentata public.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { RUNTIME_VERSION } from "@raptor/runtime";
import type { RuntimeEvent } from "@raptor/runtime";
import { runCommand } from "./run.ts";
import type { CommandInput, CommandResult } from "../shared.ts";
import { formatMs, ok, table } from "../shared.ts";

interface OtlpAttribute {
  readonly key: string;
  readonly value: Record<string, unknown>;
}

function attributeValue(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  if (value === null || value === undefined) return { stringValue: "" };
  return { stringValue: JSON.stringify(value) };
}

function attributes(source: Readonly<Record<string, unknown>>): OtlpAttribute[] {
  return Object.entries(source)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => ({ key, value: attributeValue(value) }));
}

/** Id-uri stabile pe rulare: derivate din numele span-ului, nu aleatorii. */
function spanId(traceId: string, key: string): string {
  return createHash("sha256").update(traceId + key).digest("hex").slice(0, 16);
}

function toUnixNano(baseMs: number, offsetMs: number): string {
  return String(BigInt(Math.round((baseMs + offsetMs) * 1e6)));
}

export function toOtlp(events: readonly RuntimeEvent[], project: { name: string; version: string }, startedAtMs: number): Record<string, unknown> {
  const traceId = createHash("sha256").update(`${project.name}${String.fromCharCode(0)}${startedAtMs}`).digest("hex").slice(0, 32);

  const spans = events
    .filter((event) => event.kind === "span")
    .map((event) => {
      const id = spanId(traceId, event.spanId ?? event.name);
      const span: Record<string, unknown> = {
        traceId,
        spanId: id,
        name: event.name,
        kind: 1,
        startTimeUnixNano: toUnixNano(startedAtMs, event.at),
        endTimeUnixNano: toUnixNano(startedAtMs, event.at + (event.durationMs ?? 0)),
        attributes: attributes(event.attributes),
        status: { code: event.severity === "error" ? 2 : 1 },
      };
      if (event.parentSpanId) span["parentSpanId"] = spanId(traceId, event.parentSpanId);
      return span;
    });

  const logs = events
    .filter((event) => event.kind === "log" || event.kind === "capability")
    .map((event) => ({
      timeUnixNano: toUnixNano(startedAtMs, event.at),
      severityText: event.severity.toUpperCase(),
      body: { stringValue: event.name },
      attributes: attributes(event.attributes),
    }));

  return {
    resourceSpans: [
      {
        resource: {
          attributes: attributes({
            "service.name": project.name,
            "service.version": project.version,
            "telemetry.sdk.name": "raptor-runtime",
            "telemetry.sdk.version": RUNTIME_VERSION,
          }),
        },
        scopeSpans: [{ scope: { name: "raptor:observe", version: RUNTIME_VERSION }, spans }],
      },
    ],
    resourceLogs: [
      {
        resource: { attributes: attributes({ "service.name": project.name }) },
        scopeLogs: [{ scope: { name: "raptor:observe", version: RUNTIME_VERSION }, logRecords: logs }],
      },
    ],
  };
}

export async function traceCommand(input: CommandInput): Promise<CommandResult> {
  const collected: RuntimeEvent[] = [];
  const startedAtMs = Date.now();

  const outcome = await runCommand(input, { onEvent: (event) => collected.push(event) });
  if (!outcome.host) {
    // Rularea a esuat inainte sa existe un host: raportam esecul ca atare, fara
    // sa scurgem obiectul de host in rezultatul comenzii.
    const { host: _host, ...failure } = outcome;
    return failure;
  }

  const diagnostics = outcome.host.diagnostics();
  const output = join(
    diagnostics.project.root,
    typeof input.flags["out"] === "string" ? input.flags["out"] : "./.raptor/trace.json",
  );
  const document = toOtlp(collected, { name: diagnostics.project.name, version: diagnostics.project.version }, startedAtMs);

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(document, null, 2) + "\n", "utf8");

  // Timpii cererilor: span-urile serverului, ordonate descrescator dupa durata.
  const requests = collected
    .filter((event) => event.kind === "span" && event.name.endsWith("serve.request"))
    .map((event) => ({
      path: String(event.attributes["path"] ?? "?"),
      method: String(event.attributes["method"] ?? "?"),
      status: Number(event.attributes["status"] ?? 0),
      durationMs: event.durationMs ?? 0,
    }))
    .sort((a, b) => b.durationMs - a.durationMs);

  const spanCount = collected.filter((event) => event.kind === "span").length;
  const out = [
    outcome.out,
    "",
    `urmarire scrisa in ${output}`,
    table([
      ["span-uri", String(spanCount)],
      ["evenimente", String(collected.length)],
      ["cereri", String(requests.length)],
      ...(requests.length > 0
        ? ([["cea mai lenta", `${requests[0]!.method} ${requests[0]!.path} ${formatMs(requests[0]!.durationMs)}`]] as const)
        : []),
    ]),
  ].join("\n");

  return ok(out, { ...outcome.data, trace: output, spanCount, requests });
}

/** Rezervat pentru corelarea cu urmele primite de la client (faza 2). */
export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}
