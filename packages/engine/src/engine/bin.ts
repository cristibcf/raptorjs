#!/usr/bin/env node
/**
 * Entry point `raptor` (whitepaper Appendix A). Wires runCli to process.argv.
 */
import { runCliAsync } from "./cli.ts";

const result = await runCliAsync(process.argv.slice(2));
process.stdout.write(result.out + "\n");
process.exit(result.code);
