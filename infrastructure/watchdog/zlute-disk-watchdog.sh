#!/usr/bin/env bash
# Lute disk watchdog for the shared VPS (after incident I-001). Runs every 5 minutes from cron.
# If the root filesystem reaches THRESHOLD %, it stops ONLY Lute's workloads (Docker containers
# named zlute-* and systemd units zlute-*) so Lute can never fill the disk co-tenants depend on.
# It never touches anything else. Its own log is capped at 1 MB.
set -u

# Overrides exist only for testing the stop path without touching real workloads.
THRESHOLD="${ZLUTE_WATCHDOG_THRESHOLD:-90}"
FILTER="${ZLUTE_WATCHDOG_FILTER:-^zlute-}"
UNITS="${ZLUTE_WATCHDOG_UNITS:-zlute-*}"
LOG=/opt/zlute/logs/watchdog.log
mkdir -p "$(dirname "$LOG")"
[ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 1048576 ] && tail -c 262144 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

used=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ -n "$used" ] || exit 0
if [ "$used" -lt "$THRESHOLD" ]; then
  exit 0
fi

ts=$(date -u +%FT%TZ)
running=$(docker ps --filter "name=$FILTER" --format '{{.Names}}' 2>/dev/null)
units=$(systemctl list-units --type=service --state=running --no-legend "$UNITS" 2>/dev/null | awk '{print $1}')
if [ -z "$running" ] && [ -z "$units" ]; then
  echo "$ts disk ${used}% >= ${THRESHOLD}%: no Lute workloads running; nothing to stop" >> "$LOG"
  exit 0
fi
echo "$ts disk ${used}% >= ${THRESHOLD}%: stopping Lute workloads: $(echo $running $units)" >> "$LOG"
for c in $running; do docker stop -t 10 "$c" >/dev/null 2>&1 && echo "$ts stopped container $c" >> "$LOG"; done
for u in $units; do systemctl stop "$u" && echo "$ts stopped unit $u" >> "$LOG"; done
echo "$ts largest Lute container logs:" >> "$LOG"
for c in $running; do
  f=$(docker inspect "$c" --format '{{.LogPath}}' 2>/dev/null)
  [ -n "$f" ] && du -h "$f" 2>/dev/null >> "$LOG"
done
