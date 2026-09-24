#!/usr/bin/env bash
# Compara unitatea ambalata de host-ul nativ cu cea a launcher-ului TypeScript.
# Daca lockfile-urile difera, cele doua implementari nu mai sunt interschimbabile.
set -u
BIN=/root/raptor-target/debug/raptor-runtime
SPIKE=/mnt/c/Users/crist/projects/raptorjs/examples/raptor-runtime-spike

"$BIN" pack --cwd "$SPIKE" --out ./.raptor/native-pack >/dev/null 2>&1
echo "native pack exit=$?"

echo "--- lockfile: ts vs nativ ---"
if diff "$SPIKE/.raptor/ts-pack/raptor.lock.json" "$SPIKE/.raptor/native-pack/raptor.lock.json"; then
  echo "IDENTIC"
fi

echo "--- contentIntegrity ---"
grep contentIntegrity "$SPIKE/.raptor/ts-pack/raptor.bundle.json"
grep contentIntegrity "$SPIKE/.raptor/native-pack/raptor.bundle.json"

echo "--- bundle: ts vs nativ ---"
diff "$SPIKE/.raptor/ts-pack/raptor.bundle.json" "$SPIKE/.raptor/native-pack/raptor.bundle.json" && echo "IDENTIC"
