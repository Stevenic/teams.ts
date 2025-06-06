// This script creates a root tag then pushes all created tags (when doing a release via changeset) to origin.
const { execSync } = require("child_process");
const { version } = require("../package.json");

const tag = `v${version}`;

try {
  console.log(`📌 Preparing to tag the release as: ${tag}`);
  execSync(`git tag ${tag}`, { stdio: "inherit" });
  console.log(`✅ Created tag: ${tag}`);
  execSync(`git push --tags`, { stdio: "inherit" });
  console.log(`🚀 Pushed tag: ${tag} to origin`);
} catch (err) {
  console.error("❌ Failed to tag version.", err.message);
  process.exit(1);
}
