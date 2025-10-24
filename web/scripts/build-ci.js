const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('Starting CI build process...');

// Ensure directories exist
console.log('Creating directories...');
execSync('node scripts/ensure-dirs.js', { stdio: 'inherit' });

// Copy assets
console.log('Copying assets...');
execSync('node scripts/copy-assets.js', { stdio: 'inherit' });

// Build CSS
console.log('Building CSS...');
execSync('pnpm exec postcss ./src/client/styles.css -o ./public/bundle/styles.css', { stdio: 'inherit' });

// Bundle client JavaScript
console.log('Bundling client JavaScript...');
execSync('esbuild src/client/app-entry.ts --bundle --outfile=public/bundle/client-bundle.js --format=esm --minify --define:process.env.NODE_ENV=\'"production"\'', { stdio: 'inherit' });
execSync('esbuild src/client/test-entry.ts --bundle --outfile=public/bundle/test.js --format=esm --minify --define:process.env.NODE_ENV=\'"production"\'', { stdio: 'inherit' });
execSync('esbuild src/client/sw.ts --bundle --outfile=public/sw.js --format=iife --minify --define:process.env.NODE_ENV=\'"production"\'', { stdio: 'inherit' });
applyClientBundleVersion();

// Build server TypeScript
console.log('Building server...');
// Force a clean build in CI to avoid incremental build issues
execSync('npx tsc --build --force', { stdio: 'inherit' });

// Verify dist directory exists
if (fs.existsSync(path.join(__dirname, '../dist'))) {
  const files = fs.readdirSync(path.join(__dirname, '../dist'));
  console.log(`Server build created ${files.length} files in dist/`);
  console.log('Files in dist:', files.join(', '));
  
  // Check for the essential server.js file
  if (!fs.existsSync(path.join(__dirname, '../dist/server/server.js'))) {
    console.error('ERROR: dist/server/server.js not found after tsc build!');
    console.log('Contents of dist directory:');
    execSync('find dist -type f | head -20', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    process.exit(1);
  }
} else {
  console.error('ERROR: dist directory does not exist after tsc build!');
  process.exit(1);
}

// Build native executable in CI
console.log('Building native executable for CI...');
execSync('node build-native.js', { stdio: 'inherit' });

console.log('CI build completed successfully!');

function getFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex').slice(0, 8);
}

function applyClientBundleVersion() {
  const bundlePath = path.join('public', 'bundle', 'client-bundle.js');
  if (!fs.existsSync(bundlePath)) {
    console.warn('client-bundle.js not found, skipping cache busting');
    return;
  }

  const hash = getFileHash(bundlePath);
  const versionedRef = `/bundle/client-bundle.js?v=${hash}`;
  const pattern = /\/bundle\/client-bundle\.js(\?v=[a-z0-9]+)?/g;
  const filesToPatch = [path.join('public', 'index.html'), path.join('public', 'logs.html')];

  filesToPatch.forEach((file) => {
    if (!fs.existsSync(file)) return;
    const original = fs.readFileSync(file, 'utf8');
    const updated = original.replace(pattern, versionedRef);
    fs.writeFileSync(file, updated);
  });

  console.log(`Applied cache-busting version query (?v=${hash}) to client bundle references`);
}
