#!/usr/bin/env bash
# Alias: Hunt Scout mapdata sync (see sync-scout-layers.sh).
exec "$(cd "$(dirname "$0")" && pwd)/sync-scout-layers.sh" "$@"
