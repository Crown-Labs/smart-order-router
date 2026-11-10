// Package the tested build with published SDK versions, without changing local dependencies.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.packages');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
fs.mkdirSync(output, { recursive: true });
const stage = fs.mkdtempSync(path.join(output, 'stage-'));
let tarball;
try {
  for (const name of Object.keys(pkg.dependencies)) {
    if (!name.startsWith('@kittycorn-labs/')) continue;
    const installed = JSON.parse(
      fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'))
    );
    pkg.dependencies[name] = installed.version;
  }
  delete pkg.scripts;
  delete pkg.devDependencies;
  // npm only honors overrides in the consumer root; document the required ws pin.
  delete pkg.overrides;
  fs.cpSync(path.join(root, 'build'), path.join(stage, 'build'), {
    recursive: true,
  });
  for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
    if (fs.existsSync(path.join(root, file)))
      fs.copyFileSync(path.join(root, file), path.join(stage, file));
  }
  fs.writeFileSync(
    path.join(stage, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n'
  );
  const result = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', output],
      { cwd: stage, encoding: 'utf8' }
    )
  );
  tarball = path.join(output, result[0].filename);
  console.log(tarball);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
if (process.argv.includes('--publish'))
  execFileSync('npm', ['publish', tarball, '--access', 'public'], {
    stdio: 'inherit',
  });
