#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${1:-bitwars-local}"

spacetime logs "$DB_NAME" --server local
