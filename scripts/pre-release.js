// This script is to turn all the pre-release commmands into one for ease of use.
const { execSync, exec } = require("child_process");

const dryRun =
  process.argv.includes("--dry-run") || process.argv.includes("-d");
function run(cmd, description) {
  console.log(`\n🔹 ${description}`);
  if (dryRun) {
    console.log(`[dry-run] ${cmd}`);
  } else {
    try {
      execSync(cmd, { stdio: "inherit" });
    } catch (err) {
      console.error(`❌ Step failed: ${description}`);
      process.exit(1);
    }
  }
}

const branch = execSync("git branch --show-current").toString().trim();
if (branch !== "main") {
  console.error(`❌ Not on main branch (current: ${branch}). Aborting.`);
  process.exit(1);
}
const status = execSync("git status --porcelain").toString().trim();
if (status) {
  console.error("❌ You have uncommitted changes. Please commit or stash them before running the pre-release script.");
  process.exit(1);
}

// Pull latest changes
try {
  run("git pull origin main", "Pulling latest changes");
  run("npm outdated", "Checking for outdated dependencies");
  run("npm run lint", "Running linter");
  run("npm run clean", "Cleaning repo");
  run("npm i && npm run build", "Installing dependencies and building");
  run("npm run test", "Running tests");
} catch (err) {
  console.error("❌ Step failed:", err.message);
  process.exit(1);
}

// Bump version in package.json (prerelease: x.x.x-preview.x or x.x.x, supports --bump=minor)
function bumpVersion() {
  const fs = require('fs');
  const path = require('path');
  const pkgPath = path.resolve(__dirname, '../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  let version = pkg.version;
  let newVersion;
  const bumpType = process.argv.includes('--bump=minor') ? 'minor' : 'pre';
  const prereleaseMatch = version.match(/^(\d+)\.(\d+)\.(\d+)-preview\.(\d+)$/);
  if (bumpType === 'minor') {
    // Always bump minor, reset patch and preview
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-preview\.(\d+))?$/);
    if (match) {
      const [_, major, minor] = match;
      newVersion = `${major}.${parseInt(minor, 10) + 1}.0`;
    } else {
      throw new Error('Unrecognized version format: ' + version);
    }
  } else if (prereleaseMatch) {
    // e.g. 2.0.0-preview.4 -> 2.0.0-preview.5
    const [_, major, minor, patch, pre] = prereleaseMatch;
    newVersion = `${major}.${minor}.${patch}-preview.${parseInt(pre, 10) + 1}`;
  } else {
    // e.g. 2.0.0 -> 2.0.0-preview.1
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (match) {
      const [_, major, minor, patch] = match;
      newVersion = `${major}.${minor}.${patch}-preview.1`;
    } else {
      throw new Error('Unrecognized version format: ' + version);
    }
  }
  if (dryRun) {
    console.log(`[dry-run] Would bump version: ${version} -> ${newVersion}`);
  } else {
    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`Bumped version: ${version} -> ${newVersion}`);
  }
}
bumpVersion();

console.log("✅ All pre-release checks passed!\n");
console.log("Next steps:");
console.log("1. Test the CLI manually.");
console.log("2. Run one of the development apps to ensure everything works as expected. Recommended to at least run the app in DevTools");
console.log("3. If all is well, proceed with the release process as described in RELEASE.md.\n");