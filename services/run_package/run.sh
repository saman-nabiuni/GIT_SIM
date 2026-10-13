#!/bin/sh
cd "$(dirname "$0")" || exit 1
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "import sys" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python was not found on this computer."
  echo "Install it from https://www.python.org/downloads/ and run this file again."
  exit 1
fi
exec "$PY" run_local.py
