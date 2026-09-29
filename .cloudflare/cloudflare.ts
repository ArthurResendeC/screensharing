/**
 * Keeps the Cloudflare zone matching `rules.ts`, through Cloudflare's API:
 *
 *   bun run cf:plan    diff the zone's settings and ReShare's rules against rules.ts; changes nothing
 *   bun run cf:apply   make them match
 *
 * `apply` only replaces the rules whose description starts with `MANAGED_PREFIX`; the zone's other
 * rules in the same phases are sent back unchanged.
 *
 * Auth: `CLOUDFLARE_API_TOKEN`, with Zone: Read, Bot Management: Read, and Edit on Zone Settings,
 * Config Rules and Zone WAF, on the zone.
 */
import process from 'node:process';

import {
  BOT_MANAGEMENT,
  MANAGED_PREFIX,
  type Rule,
  RULESETS,
  SETTINGS,
  ZONE,
} from './rules.ts';

const API_URL = 'https://api.cloudflare.com/client/v4';
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

/**
 * The API token permission each call needs, so a 403 (Cloudflare reports a missing permission as
 * "Authentication error (10000)") says what to add. Checked in order; the first match wins.
 */
const REQUIRED_PERMISSIONS: Array<[RegExp, string]> = [
  [/\/settings\//u, 'Zone Settings'],
  [/\/bot_management$/u, 'Bot Management'],
  [/\/phases\/http_config_settings\//u, 'Config Rules'],
  [/\/phases\/http_request_firewall_custom\//u, 'Zone WAF'],
  [/\/phases\/http_ratelimit\//u, 'Zone WAF'],
  [/^\/zones\?/u, 'Zone'],
];

/** Fields Cloudflare adds to a rule, left out when sending another hostname's rule back. */
const READ_ONLY_RULE_FIELDS = new Set(['id', 'version', 'last_updated']);

function missingPermissionHint(path: string, method: string): string {
  const permission = REQUIRED_PERMISSIONS.find(([pattern]) =>
    pattern.test(path),
  )?.[1];

  if (permission === undefined) {
    return '';
  }

  const level = method === 'GET' ? 'Read' : 'Edit';

  return `\nThe token is missing "Zone → ${permission} → ${level}" (Edit covers Read) on this zone.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Calls the API and returns `result`. Cloudflare wraps every response in
 * `{ success, errors, result }` and can report failures with a 200, so both are checked.
 * `undefined` means 404 (e.g. a phase with no entry-point ruleset yet).
 */
async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (token === undefined || token.length === 0) {
    throw new Error(
      `Set CLOUDFLARE_API_TOKEN to a Cloudflare API token for ${ZONE}.`,
    );
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });

  if (response.status === HTTP_NOT_FOUND) {
    return undefined;
  }

  const body: unknown = await response.json();

  if (!response.ok || !isRecord(body) || body.success !== true) {
    const errors =
      isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
    const messages = errors.map(error => describeError(error));

    const method = init.method ?? 'GET';
    const hint =
      response.status === HTTP_FORBIDDEN
        ? missingPermissionHint(path, method)
        : '';

    throw new Error(
      `Cloudflare API ${method} ${path} failed (${response.status}): ${messages.join('; ')}${hint}`,
    );
  }

  return body.result;
}

/** `message (code)`, plus the nested `error_chain` Cloudflare adds with the specific cause. */
function describeError(error: unknown): string {
  if (!isRecord(error)) {
    return String(error);
  }

  const chain = Array.isArray(error.error_chain) ? error.error_chain : [];
  const causes = chain.map(cause => describeError(cause));

  return `${String(error.message)} (${String(error.code)})${causes.length > 0 ? `: ${causes.join('; ')}` : ''}`;
}

async function zoneId(name: string): Promise<string> {
  const result = await api(`/zones?name=${encodeURIComponent(name)}`);
  const zone = Array.isArray(result)
    ? result.find(item => isRecord(item) && item.name === name)
    : undefined;

  if (!isRecord(zone) || typeof zone.id !== 'string') {
    throw new Error(`Cloudflare zone ${name} isn't visible to this token.`);
  }

  return zone.id;
}

/**
 * `live` reduced to the keys `desired` sets, so the defaults and IDs Cloudflare adds don't show up
 * as differences.
 */
function project(live: unknown, desired: unknown): unknown {
  if (Array.isArray(desired)) {
    return Array.isArray(live)
      ? desired.map((item, index) => project(live[index], item))
      : live;
  }

  if (isRecord(desired)) {
    return isRecord(live)
      ? Object.fromEntries(
          Object.keys(desired).map(key => [
            key,
            project(live[key], desired[key]),
          ]),
        )
      : live;
  }

  return live;
}

function sameAs(live: unknown, desired: unknown): boolean {
  return JSON.stringify(project(live, desired)) === JSON.stringify(desired);
}

function isManaged(rule: unknown): boolean {
  return (
    isRecord(rule) &&
    typeof rule.description === 'string' &&
    rule.description.startsWith(MANAGED_PREFIX)
  );
}

/**
 * Only checks Bot Fight Mode: Cloudflare answers the API's update with "Bad Request (10400)" on
 * Free-plan zones, so it's turned on once in the dashboard (Security → Settings → Bot fight mode).
 * It's what catches bots the rules can't tell from a browser, so one that's off fails the run
 * (after the plan is printed) rather than passing as "No changes". Returns whether it matches.
 */
async function checkBotManagement(zone: string): Promise<boolean> {
  const live = await api(`/zones/${zone}/bot_management`);
  const current = isRecord(live) ? live : {};
  let matches = true;

  for (const [field, value] of Object.entries(BOT_MANAGEMENT)) {
    if (current[field] === value) {
      console.log(`  = bot management ${field}: ${String(value)}`);
    } else {
      matches = false;
      console.log(
        `  ! bot management ${field} is ${String(current[field])}: set it to ${String(value)} in the dashboard (Security → Settings → Bot fight mode)`,
      );
    }
  }

  return matches;
}

async function liveRules(zone: string, phase: string): Promise<unknown[]> {
  const ruleset = await api(
    `/zones/${zone}/rulesets/phases/${phase}/entrypoint`,
  );

  return isRecord(ruleset) && Array.isArray(ruleset.rules) ? ruleset.rules : [];
}

/** Prints what `apply` would change in ReShare's rules of one phase; returns whether anything differs. */
function printRulesPlan(
  phase: string,
  managed: unknown[],
  others: unknown[],
  desired: Rule[],
): boolean {
  let changed = managed.length !== desired.length;

  console.log(`  ${phase}`);
  for (const [index, rule] of desired.entries()) {
    const current = managed[index];
    const marker =
      current === undefined ? '+' : sameAs(current, rule) ? '=' : '~';

    changed ||= marker !== '=';
    console.log(`    ${marker} ${rule.description}`);
  }

  for (const extra of managed.slice(desired.length)) {
    console.log(`    - ${isRecord(extra) ? String(extra.description) : ''}`);
  }

  if (others.length > 0) {
    console.log(`    (${others.length} other rule(s) in this phase kept)`);
  }

  return changed;
}

function withoutReadOnlyFields(rule: unknown): unknown {
  return isRecord(rule)
    ? Object.fromEntries(
        Object.entries(rule).filter(([key]) => !READ_ONLY_RULE_FIELDS.has(key)),
      )
    : rule;
}

async function syncZone(zone: string, apply: boolean): Promise<boolean> {
  let changed = false;

  console.log(`\n${ZONE} (${zone})`);

  for (const [setting, value] of Object.entries(SETTINGS)) {
    const current = await api(`/zones/${zone}/settings/${setting}`);
    const currentValue = isRecord(current) ? current.value : undefined;
    const same = currentValue === value;

    changed ||= !same;
    console.log(
      `  ${same ? '=' : '~'} setting ${setting}: ${String(currentValue)} → ${value}`,
    );

    if (apply && !same) {
      await api(`/zones/${zone}/settings/${setting}`, {
        body: JSON.stringify({ value }),
        method: 'PATCH',
      });
    }
  }

  for (const [phase, desired] of Object.entries(RULESETS)) {
    const live = await liveRules(zone, phase);
    const managed = live.filter(rule => isManaged(rule));
    const others = live.filter(rule => !isManaged(rule));
    const phaseChanged = printRulesPlan(phase, managed, others, desired);

    changed ||= phaseChanged;

    if (apply && phaseChanged) {
      await api(`/zones/${zone}/rulesets/phases/${phase}/entrypoint`, {
        body: JSON.stringify({
          rules: [...desired, ...others.map(withoutReadOnlyFields)],
        }),
        method: 'PUT',
      });
    }
  }

  return changed;
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command !== 'plan' && command !== 'apply') {
    throw new Error('Usage: bun .cloudflare/cloudflare.ts <plan|apply>');
  }

  const zone = await zoneId(ZONE);
  const changed = await syncZone(zone, command === 'apply');
  const botManagementOk = await checkBotManagement(zone);

  if (!changed) {
    console.log('\nNo changes.');
  } else {
    console.log(
      command === 'apply' ? '\nApplied.' : '\nCloudflare would change.',
    );
  }

  if (!botManagementOk) {
    throw new Error(
      "\nBot Fight Mode is off (the ! line above): turn it on in the dashboard, since the API can't on Free zones.",
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
