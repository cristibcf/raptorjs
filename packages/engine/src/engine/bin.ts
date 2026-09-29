#!/usr/bin/env node
/**
 * Entry point `raptor` (whitepaper Appendix A). Leaga runCli la process.argv.
 */
import { runCliAsync } from "./cli.ts";

const result = await runCliAsync(process.argv.slice(2));
process.stdout.write(result.out + "\n");
process.exit(result.code);
