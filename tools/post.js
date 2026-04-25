#!/usr/bin/env node
// Outputs installer footer lines as MUSH think commands.

const LINES = [
  'think [ansi(hc,Installation complete!)]',
  'think [ansi(c,You may now @shutdown/reboot.)]',
];

process.stdout.write(LINES.join('\n') + '\n');
