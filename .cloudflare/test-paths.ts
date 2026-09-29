/**
 * Paths the Cloudflare rules are tested against (`rules.test.ts`): what the server serves, read
 * from its source and its production build, and what scanners probe for.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = `${import.meta.dir}/..`;

const serverSource = await Bun.file(`${REPO_ROOT}/server/index.ts`).text();

/**
 * Every route key in `server/index.ts` (`'/config.json': …`) plus the path its `fetch` accepts
 * (`/signaling`), with `:param` segments filled with a sample. Read from the source, so a new route
 * the rules would block fails the tests instead of being blocked in production.
 */
export const SERVER_ROUTES = [
  ...serverSource.matchAll(/^\s+'(\/[^']*)':/gmu),
  ...serverSource.matchAll(/pathname !== '(\/[^']*)'/gu),
].map(([, path = '']) =>
  path.replace(/:[A-Za-z]+/gu, '3f1c2b1e-9d6a-4b8e-8a0e-2b4c6d8e0f11'),
);

/**
 * The client files Bun serves from the root, as `bun run build` names them (`/index-jwx617f2.js`).
 * Built into a temporary directory, so a new kind of asset the rules would block fails the tests.
 */
function buildAssetPaths(): string[] {
  const outdir = mkdtempSync(join(tmpdir(), 'reshare-cf-'));

  try {
    const build = Bun.spawnSync(
      [
        process.execPath,
        'build',
        '--target=bun',
        '--production',
        `--outdir=${outdir}`,
        'server/index.ts',
      ],
      { cwd: REPO_ROOT, stderr: 'pipe' },
    );

    if (!build.success) {
      throw new Error(`bun build failed: ${build.stderr.toString()}`);
    }

    return [...new Bun.Glob('*').scanSync({ cwd: outdir })]
      .filter(file => file !== 'index.js' && !file.endsWith('.html'))
      .map(file => `/${file}`);
  } finally {
    rmSync(outdir, { force: true, recursive: true });
  }
}

export const ASSET_PATHS = buildAssetPaths();

/** Everything the server answers with something other than its 404. */
export const SITE_PATHS = [...SERVER_ROUTES, ...ASSET_PATHS];

/** Scanner probes for files and endpoints the server never serves. All of them are blocked. */
export const SCANNER_PATHS = [
  '/.env',
  '/.env.production',
  '/.git/config',
  '/.git/HEAD',
  '/.aws/credentials',
  '/.ssh/id_rsa',
  '/.DS_Store',
  '/.htaccess',
  '/.well-known/security.txt',
  '/config.js',
  '/env.js',
  '/sw.js',
  '/webpack.config.js',
  '/js/config.js',
  '/assets/config.js',
  '/assets/index-jwx617f2.js',
  '/icons/.env',
  '/icons/config.js',
  '/config.yaml',
  '/docker-compose.yml',
  '/service-account.json',
  '/firebase-admin.json',
  '/google-services.json',
  '/package.json',
  '/composer.lock',
  '/backup.sql',
  '/backup.zip',
  '/site.tar.gz',
  '/server.key',
  '/index.php',
  '/info.php',
  '/phpinfo.php~',
  '/wp-login.php',
  '/wp-admin/',
  '/wp-admin/setup-config.php',
  '/wp-content/plugins/x/readme.txt',
  '/wp-includes/wlwmanifest.xml',
  '/xmlrpc.php',
  '/phpmyadmin/',
  '/cgi-bin/luci',
  '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
  '/actuator/env',
  '/server-status',
  '/_ignition/execute-solution',
  '/manager/html',
  '/login.aspx',
  '/graphql',
  '/api/graphql',
  '/_next/static/chunks/main.js',
  '/@fs/proc/self/environ',
  '/proc/self/environ',
  '/static/../../../proc/self/environ',
  '/index-/../.env',
  '/debug/pprof',
  '/console',
  '/env',
  '/admin',
  '/login',
  '/api/v1/keys',
  '/mcp',
  '/sitemap.xml',
  '/robots.txt',
  '//wp/',
  // Probes shaped like the site's own paths.
  '/room/',
  '/room/.env',
  '/room/../.env',
  '/room/x/config.php',
  '/room/3f1c2b1e-9d6a-4b8e-8a0e-2b4c6d8e0f11/.git/config',
  '/realtime/',
  '/realtime/session/x',
  '/config.json/.env',
  '/health.php',
  '/signaling.php',
];
