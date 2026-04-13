const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function newestMatchingFile(dir, re) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const matches = entries
    .filter((e) => e.isFile() && re.test(e.name))
    .map((e) => {
      const full = path.join(dir, e.name);
      const stat = fs.statSync(full);
      return { full, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.full ?? null;
}

function main() {
  const projectRoot = path.join(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');

  if (!fs.existsSync(distDir)) {
    console.error(`dist folder not found: ${distDir}`);
    process.exit(1);
  }

  const installer = newestMatchingFile(distDir, /^PySearch-Setup-.*\.exe$/i);
  if (!installer) {
    console.error('No installer found in dist/. Build first (npm run build).');
    process.exit(1);
  }

  const child = spawn(installer, [], { detached: true, stdio: 'ignore' });
  child.unref();

  console.log(`Launched installer: ${installer}`);
}

main();

