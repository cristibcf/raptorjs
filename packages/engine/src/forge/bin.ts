#!/usr/bin/env node
import { runForgeCli } from "./cli.ts";

const result = runForgeCli(process.argv.slice(2));
process.stdout.write(result.out + "\n");
process.exit(result.code);
