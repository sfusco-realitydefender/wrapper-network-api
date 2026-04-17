#!/usr/bin/env bash
exec "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/_launch.sh" start docker-compose-video.yml 3333
