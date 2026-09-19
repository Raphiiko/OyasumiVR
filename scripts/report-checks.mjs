import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks, checkName } from './checks.mjs';

export function readResults(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readResults(path);
    if (entry.name !== 'results.json') return [];
    const results = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(results)) throw new Error('Invalid check results');
    return results;
  });
}

export function checkResult(id, results) {
  const matches = results.filter((result) => result.id === id);
  if (!matches.length) return { status: 'not run' };
  if (matches.length !== 1) throw new Error(`Duplicate result: ${id}`);
  const result = matches[0];
  if (
    !['passed', 'failed'].includes(result.status) ||
    !Number.isFinite(result.durationMs) ||
    result.durationMs < 0 ||
    (result.attempt !== undefined && (!Number.isInteger(result.attempt) || result.attempt < 1))
  )
    throw new Error(`Invalid result: ${id}`);
  return result;
}

export function jobsPassed(jobs, selected) {
  if (jobs.select?.result !== 'success') return false;
  const native = selected.some((id) => checks[id].group === 'native');
  const portable = selected.some((id) => checks[id].group !== 'native');
  return (
    jobs.portable?.result === (portable ? 'success' : 'skipped') &&
    jobs['native-execution']?.result === (native ? 'success' : 'skipped') &&
    jobs['native-results']?.result === (native ? 'success' : 'skipped')
  );
}

function resultLabel(result) {
  return result.attempt && result.attempt !== Number(process.env.GITHUB_RUN_ATTEMPT)
    ? `${result.status} (attempt ${result.attempt})`
    : result.status;
}

export function summary(selected, results) {
  const lines = [
    '## Check results',
    '',
    '| Check | Command | Result | Duration |',
    '| --- | --- | --- | --- |',
  ];
  for (const id of Object.keys(checks)) {
    const result =
      selected === null
        ? { status: 'selection unavailable' }
        : selected.includes(id)
          ? checkResult(id, results)
          : { status: 'not needed' };
    const duration =
      result.durationMs === undefined ? '-' : `${(result.durationMs / 1000).toFixed(1)}s`;
    lines.push(
      `| ${checkName(id)} | \`npm run check:${id}\` | ${resultLabel(result)} | ${duration} |`
    );
  }
  if (Number(process.env.GITHUB_RUN_ATTEMPT) > 1)
    lines.push(
      '',
      'Earlier results show their attempt number. Rerun jobs without a new result do not establish a fresh pass.'
    );
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const results = readResults('.check-results');
    if (process.env.CHECK_ID) {
      const id = process.env.CHECK_ID;
      if (!Object.hasOwn(checks, id)) throw new Error('Unknown check');
      const result = checkResult(id, results);
      console.log(
        `${checkName(id)}: ${resultLabel(result)}. Command output is in the Windows check execution job.`
      );
      if (result.status !== 'passed') process.exitCode = 1;
    } else {
      const selected = process.env.SELECTED_CHECKS ? JSON.parse(process.env.SELECTED_CHECKS) : null;
      if (
        selected !== null &&
        (!Array.isArray(selected) || selected.some((id) => !Object.hasOwn(checks, id)))
      )
        throw new Error('Invalid check selection');
      const report = summary(selected, results);
      console.log(report);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
      if (
        selected === null ||
        !jobsPassed(JSON.parse(process.env.JOB_RESULTS), selected) ||
        selected.some((id) => checkResult(id, results).status !== 'passed')
      )
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        '\nCheck reporting failed. See the job log.\n'
      );
    process.exitCode = 1;
  }
}
