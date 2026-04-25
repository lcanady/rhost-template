/**
 * Runs all security test suites.
 * Usage: npx ts-node tests/security/all.ts
 */
import './dep-name-traversal.test';
import './ssrf-redirect.test';
import './build-cmd-injection.test';
import './registry-validation.test';
import './env-secrets.test';
import './network-timeout.test';
