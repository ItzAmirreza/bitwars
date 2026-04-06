#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DB_NAME="${1:-bitwars-local}"

spacetime publish "$DB_NAME" --server local --clear-database -y --module-path ./spacetimedb
