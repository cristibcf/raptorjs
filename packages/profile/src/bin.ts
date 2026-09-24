#!/usr/bin/env node
/**
 * Entry point `raptor-profile` (whitepaper Appendix A: `raptor profile`).
 */
import { runProfileCli } from "./cli.ts";

const result = runProfileCli(process.argv.slice(2));
process.stdout.write(result.out + "\n");
process.exit(result.code);
