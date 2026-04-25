/**
 * Minimal security test runner using node:test + node:assert.
 * No extra deps required — built into Node 18+.
 *
 * Usage:
 *   npx ts-node tests/security/<suite>.test.ts
 *   npx ts-node tests/security/all.ts   ← runs all suites
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
export { test, describe, assert };
