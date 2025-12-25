#!/usr/bin/env bash
set -euo pipefail

# Bumps patch version, installs deps, runs checks/builds, and publishes to npm.
npm version patch --no-git-tag-version
npm install
npm run all-checks

version=$(npm pkg get version | tr -d '"')
git add package.json package-lock.json
git commit -m "Release v$version"
npm publish
