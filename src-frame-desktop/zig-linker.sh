#!/bin/sh
set -eu
exec "$OYASUMIVR_FRAME_ZIG" cc -target aarch64-linux-gnu.2.28 "$@"
