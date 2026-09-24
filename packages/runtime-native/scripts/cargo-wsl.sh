#!/usr/bin/env bash
# Ruleaza suita nativa din WSL. Artefactele de build stau in filesystem-ul Linux
# (`CARGO_TARGET_DIR`), nu pe /mnt/c: pe 9p, compilarea ar fi de cateva ori mai lenta.
set -u
source "$HOME/.cargo/env"
export CARGO_TARGET_DIR=/root/raptor-target
cd /mnt/c/Users/crist/projects/raptorjs/packages/runtime-native || exit 1
exec cargo "$@"
