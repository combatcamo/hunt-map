#!/usr/bin/env python3
"""Atomically write Hunt Scout inbox GeoJSON.
Usage:
  write-inbox-geojson.py user_food.geojson < food.json
  write-inbox-geojson.py user_water.geojson --file ./user_water.geojson
  write-inbox-geojson.py --dir ./exports
    # copies any of user_{water,food,scrape,rub}.geojson found in that folder
"""
import json, os, sys, tempfile
from pathlib import Path
INBOX = Path('/workspace/hunt-scout/inbox')
ALLOWED = {
    'user_food.geojson',
    'user_water.geojson',
    'user_scrape.geojson',
    'user_rub.geojson',
}

def write_one(name, data):
    if name not in ALLOWED:
        print('refusing', name, file=sys.stderr)
        sys.exit(2)
    obj = json.loads(data) if isinstance(data, str) else data
    if obj.get('type') != 'FeatureCollection':
        raise SystemExit(f'{name}: expected FeatureCollection')
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

def main():
    if len(sys.argv) >= 2 and sys.argv[1] == '--dir':
        if len(sys.argv) < 3:
            print('usage: write-inbox-geojson.py --dir <folder>', file=sys.stderr)
            sys.exit(2)
        folder = Path(sys.argv[2])
        found = 0
        for name in sorted(ALLOWED):
            path = folder / name
            if path.is_file():
                write_one(name, path.read_text(encoding='utf-8'))
                found += 1
        if not found:
            raise SystemExit(f'no inbox files in {folder}')
        return
    if len(sys.argv) < 2:
        print('usage: write-inbox-geojson.py <user_{water,food,scrape,rub}.geojson> [--file path|stdin]', file=sys.stderr)
        print('       write-inbox-geojson.py --dir <folder>', file=sys.stderr)
        sys.exit(2)
    name = sys.argv[1]
    if len(sys.argv) >= 4 and sys.argv[2] == '--file':
        data = Path(sys.argv[3]).read_text(encoding='utf-8')
    else:
        data = sys.stdin.read()
    write_one(name, data)

if __name__ == '__main__':
    main()
