// Resolve one complete SDK release, then pin all six packages and update the lockfile.
const { execFileSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const { dependencies } = require('../package.json');
const names = Object.keys(dependencies).filter((name) =>
  name.startsWith('@kittycorn-labs/')
);
const requested = process.argv[2] || 'latest';
if (!/^(latest|\d+\.\d+\.\d+)$/.test(requested))
  throw new Error('Usage: npm run sdk:update [-- <version>]');
const versions = names.map((name) =>
  JSON.parse(
    execFileSync(
      'npm',
      ['view', `${name}@${requested}`, 'version', '--json', '--prefer-online'],
      {
        cwd: root,
        encoding: 'utf8',
      }
    )
  )
);
if (new Set(versions).size !== 1)
  throw new Error(
    'SDK releases are not aligned yet. Wait for all six packages, then retry.'
  );
const version = versions[0];
console.log(`Updating all ${names.length} Kittycorn SDKs to ${version}`);
execFileSync(
  'npm',
  [
    'install',
    '--ignore-scripts',
    '--save-exact',
    ...names.map((name) => `${name}@${version}`),
  ],
  {
    cwd: root,
    stdio: 'inherit',
  }
);
console.log(
  'SDK dependencies and lockfile updated. Build and test before publishing SOR.'
);
