#!/usr/bin/env bun
/**
 * Script to initialize a SQLite database
 * Usage: bun run scripts/initialiseDB.ts <dbpath> [--force]
 */

import { initDB } from '../src/services/initDB.js';
import { parseArgs } from 'util';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    force: {
      type: 'boolean',
      short: 'f',
      default: false,
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Usage: bun run scripts/initialiseDB.ts <dbpath> [--force]

Arguments:
  dbpath       Path to the SQLite database file

Options:
  -f, --force  Delete existing database if it exists
  -h, --help   Show this help message
`);
  process.exit(values.help ? 0 : 1);
}

const dbPath = positionals[0];
const result = await initDB(dbPath, { force: values.force });

if (result.success) {
  console.log(`✓ ${result.message}`);
  if (result.tables) {
    console.log(`  Tables created: ${result.tables.join(', ')}`);
    console.log(`  Views created: ${result.views.join(', ')}`);
  }
} else {
  console.error(`✗ ${result.message}`);
  process.exit(1);
}
