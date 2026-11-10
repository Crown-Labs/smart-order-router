// Verify checked-in ABI/bytecode fixtures, optionally against their pinned npm artifacts.
// --refresh updates snapshots after deliberately changing versions in abi-sources.json.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const manifest = path.join(__dirname, 'abi-sources.json');
const entries = JSON.parse(fs.readFileSync(manifest));
const refresh = process.argv.includes('--refresh');
const upstream = refresh || process.argv.includes('--verify-upstream');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kittycorn-abis-'));
const archives = new Map();
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
try {
  for (const entry of entries) {
    const file = path.resolve(root, entry.output);
    if (!file.startsWith(root + path.sep))
      throw new Error('ABI output must be inside this repository');
    let content = fs.readFileSync(file, 'utf8');
    if (upstream) {
      const spec = `${entry.package}@${entry.version}`;
      if (!archives.has(spec)) {
        const packed = JSON.parse(
          execFileSync(
            'npm',
            [
              'pack',
              spec,
              '--ignore-scripts',
              '--json',
              '--pack-destination',
              temp,
            ],
            { encoding: 'utf8' }
          )
        );
        archives.set(spec, path.join(temp, path.basename(packed[0].filename)));
      }
      const artifact = JSON.parse(
        execFileSync(
          'tar',
          ['-xOf', archives.get(spec), `package/${entry.artifact}`],
          { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
        )
      );
      const expected =
        JSON.stringify(
          Object.fromEntries(entry.fields.map((key) => [key, artifact[key]])),
          null,
          2
        ) + '\n';
      if (refresh) {
        content = expected;
        fs.writeFileSync(file, content);
        entry.sha256 = hash(content);
      } else if (content !== expected)
        throw new Error(`Upstream ABI differs: ${entry.output}`);
    }
    if (hash(content) !== entry.sha256)
      throw new Error(`ABI checksum differs: ${entry.output}`);
  }
  if (refresh)
    fs.writeFileSync(manifest, JSON.stringify(entries, null, 2) + '\n');
  console.log(
    `Verified ${entries.length} pinned ABI/bytecode snapshots${
      upstream ? ' against npm artifacts' : ''
    }`
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
