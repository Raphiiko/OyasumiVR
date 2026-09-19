import { checks, runChecks } from './checks.mjs';

try {
  const selected = JSON.parse(process.env.SELECTED_CHECKS);
  if (!Array.isArray(selected) || selected.some((id) => !Object.hasOwn(checks, id)))
    throw new Error('Invalid check selection');
  runChecks(selected);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
