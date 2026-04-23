#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-${ROOT_DIR}/../AISCL-release-candidate}"

mkdir -p "${TARGET_DIR}"

rsync -a --delete \
  --exclude '.git/' \
  --exclude '.DS_Store' \
  --exclude '__pycache__/' \
  --exclude '.venv-smoke/' \
  --exclude '.venv_smoke/' \
  --exclude '.vscode/' \
  --exclude 'node_modules/' \
  --exclude 'frontend/node_modules/' \
  --exclude 'frontend/dist/' \
  --exclude 'frontend/frontend/' \
  --exclude 'frontend/src/.log/' \
  --exclude 'backend/.pytest_cache/' \
  --exclude 'backend/scripts/' \
  --exclude 'backend/.env' \
  --exclude 'frontend/.env.local' \
  --exclude 'Docs/' \
  --exclude 'OPTIMIZATION_SUMMARY.md' \
  --exclude 'scripts/__pycache__/' \
  --exclude 'scripts/ui_*' \
  --exclude 'scripts/api_template_binding_smoke_run.py' \
  --exclude 'backend/tests/' \
  --exclude 'backend/test_*.py' \
  --exclude 'backend/minimal_test.py' \
  --exclude 'backend/fix_app.py' \
  --exclude 'backend/create_test_users.py' \
  "${ROOT_DIR}/" "${TARGET_DIR}/"

printf 'Release repository prepared at: %s\n' "${TARGET_DIR}"
printf 'Next steps:\n'
printf '  1. cd %s\n' "${TARGET_DIR}"
printf '  2. git init\n'
printf '  3. git remote add origin <your-github-repo>\n'
printf '  4. git add . && git commit -m \"Initial deployable release\"\n'
printf '  5. git push -u origin main\n'
