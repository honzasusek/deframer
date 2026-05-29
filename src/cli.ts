#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deframe } from "./deframe.js";

function usage(): never {
  console.error(
    `deframer — convert a Framer-generated component into a clean React + CSS component

Usage:
  deframer <input.js> [--out <dir>]

Options:
  --out <dir>   Output directory (default: ./out)
  -h, --help    Show this help`,
  );
  process.exit(1);
}

function main(argv: string[]): void {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) usage();

  let input: string | undefined;
  let outDir = "out";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") {
      outDir = args[++i] ?? usage();
    } else if (!input) {
      input = a;
    } else {
      console.error(`Unexpected argument: ${a}`);
      usage();
    }
  }
  if (!input) usage();

  const inputPath = resolve(input);
  const source = readFileSync(inputPath, "utf8");

  const result = deframe(source);

  const outRoot = resolve(outDir);
  mkdirSync(outRoot, { recursive: true });

  const tsxPath = join(outRoot, `${result.componentName}.tsx`);
  const cssPath = join(outRoot, result.cssFileName);
  writeFileSync(tsxPath, result.tsx, "utf8");
  writeFileSync(cssPath, result.css, "utf8");

  for (const stub of result.stubs) {
    const stubPath = join(outRoot, stub.path);
    mkdirSync(dirname(stubPath), { recursive: true });
    writeFileSync(stubPath, stub.content, "utf8");
  }

  console.log(`✓ ${result.componentName}`);
  console.log(`  ${tsxPath}`);
  console.log(`  ${cssPath}`);
  for (const stub of result.stubs) {
    console.log(`  ${join(outRoot, stub.path)}`);
  }
  for (const note of result.notes) {
    console.log(`  note: ${note}`);
  }
}

main(process.argv);
