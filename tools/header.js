#!/usr/bin/env node
// Outputs installer header lines as MUSH think commands.
// Edit TITLE and AUTHOR to match your project.

const TITLE  = 'My RhostMUSH Project';
const AUTHOR = 'Wizard';

const LINES = [
  `think [ansi(hc,>> Installing: ${TITLE})]`,
  `think [ansi(c,>> Author: ${AUTHOR})]`,
  `think [ansi(c,>> Stand by...)]`,
];

process.stdout.write(LINES.join('\n') + '\n');
