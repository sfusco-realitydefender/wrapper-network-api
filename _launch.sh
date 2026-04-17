#!/usr/bin/env bash
set -euo pipefail

action="$1"
compose="$2"
port="${3:-}"

repo_dir="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
cd "$repo_dir"

case "$action" in
    start)
        docker compose -f "$compose" up -d --build
        url="http://localhost:${port}"
        for _ in {1..60}; do
            curl -fsS -o /dev/null "$url" && break
            sleep 1
        done
        xdg-open "$url" >/dev/null 2>&1 &
        ;;
    stop)
        docker compose -f "$compose" down
        ;;
    *)
        echo "Unknown action: $action" >&2
        exit 1
        ;;
esac
