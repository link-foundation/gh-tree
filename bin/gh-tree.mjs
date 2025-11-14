#!/usr/bin/env node
import { ghTree } from "../src/index.mjs";

const run = async () => {
  try {
    const code = await ghTree();
    process.exit(code);
  } catch (err) {
    console.error(err?.stack || String(err));
    process.exit(1);
  }
};

run();

