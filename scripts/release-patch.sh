#!/usr/bin/env bash
set -euo pipefail

# Bumps patch version, installs deps, runs checks/builds, and publishes to npm.
npm version patch --no-git-tag-version
npm install
npm run all-checks
npm publish
