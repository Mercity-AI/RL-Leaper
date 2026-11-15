#!/usr/bin/env bash
# Copy this whole working copy (code, docs, every checkpoint, exam and diagnostic
# file in rl_artifacts/) to a Hugging Face storage bucket folder.
#
#   HF_TOKEN=hf_xxx scripts/sync_to_bucket.sh hf://buckets/<namespace>/<bucket>/<folder>
#
# Skips only what is rebuilt or already on GitHub: .venv/ (pip install -r
# requirements-rl.txt), .git/, node_modules/, __pycache__/. Safe to re-run:
# only new or changed files are sent, nothing in the bucket is deleted.
set -euo pipefail
DEST=${1:?"usage: scripts/sync_to_bucket.sh hf://buckets/<namespace>/<bucket>/<folder>"}
cd "$(dirname "$0")/.."
exec .venv/bin/hf sync . "$DEST" \
  --exclude ".venv/*" --exclude ".git/*" --exclude "node_modules/*" \
  --exclude "__pycache__/*" --exclude "*/__pycache__/*" --exclude "*.pyc"
