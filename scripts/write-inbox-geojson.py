#!/usr/bin/env python3
"""Atomically write a GeoJSON FeatureCollection into /workspace/hunt-scout/inbox/.
Usage: write-inbox-geojson.py user_food.geojson < food.json
       write-inbox-geojson.py user_water.geojson --file ./user_water.geojson
"""
import json, os, sys, tempfile
from pathlib import Path
INBOX = Path('/workspace/hunt-scout/inbox')
ALLOWED = {'user_food.geojson', 'user_water.geojson'}

def main():
  if len(sys.argv) < 2:
    print('usage: write-inbox-geojson.py <user_food.geojson|user_water.geojson> [--file path|stdin]', file=sys.stderr)
    sys.exit(2)
  name = sys.argv[1]
  if name not in ALLOWED:
    print('refusing', name, file=sys.stderr); sys.exit(2)
  if len(sys.argv) >= 4 and sys.argv[2] == '--file':
    data = Path(sys.argv[3]).read_text(encoding='utf-8')
  else:
    data = sys.stdin.read()
  obj = json.loads(data)
  if obj.get('type') != 'FeatureCollection':
    raise SystemExit('expected FeatureCollection')
  INBOX.mkdir(parents=True, exist_ok=True)
  dest = INBOX / name
  fd, tmp = tempfile.mkstemp(dir=str(INBOX), prefix='.' + name + '.', suffix='.tmp')
  try:
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
      json.dump(obj, f, separators=(',', ':'))
      f.write('\n')
      f.flush(); os.fsync(f.fileno())
    os.replace(tmp, dest)
  except Exception:
    try: os.unlink(tmp)
    except OSError: pass
    raise
  print(f'wrote {dest} ({dest.stat().st_size} bytes, {len(obj.get("features") or [])} features)')

if __name__ == '__main__':
  main()
