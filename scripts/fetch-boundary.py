#!/usr/bin/env python3
"""Fetch the Mount Magazine WMA boundary (AGFC, objectid 37) as GeoJSON into data/wma-boundary.geojson.
Tries AGFC first (slow; retried), then the Arkansas GIS Office mirror. Standard library only."""
import json, os, sys, time, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = [
    "https://gisec2.agfc.com/arcgis/rest/services/GIS/AGFC_DATA/FeatureServer/11/query?where=objectid%3D37&outFields=fname,wma,acres&outSR=4326&f=geojson",
    "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Boundaries/FeatureServer/37/query?where=objectid%3D37&outFields=fname,wma&outSR=4326&f=geojson",
]
def ok(d):
    f = (d.get("features") or [None])[0]
    if not f or "Magazine" not in str(f.get("properties", {}).get("fname", "")): return False
    g = f.get("geometry") or {}
    if g.get("type") not in ("Polygon", "MultiPolygon"): return False
    xs = []
    def walk(c):
        if isinstance(c[0], (int, float)): xs.append(c)
        else: [walk(i) for i in c]
    walk(g["coordinates"])
    lon = [p[0] for p in xs]; lat = [p[1] for p in xs]
    return len(xs) > 200 and -94.0 < min(lon) and max(lon) < -93.2 and 35.0 < min(lat) and max(lat) < 35.4
for url in SOURCES:
    for attempt in range(4):
        try:
            d = json.load(urllib.request.urlopen(url, timeout=90))
            if ok(d):
                d["features"] = d["features"][:1]
                json.dump(d, open(os.path.join(ROOT, "data/wma-boundary.geojson"), "w"), separators=(",", ":"))
                print("boundary from", url.split("/rest/")[0]); sys.exit(0)
            print("unexpected response from", url, file=sys.stderr); break
        except Exception as e:
            print("retry", attempt + 1, url.split("/rest/")[0], e, file=sys.stderr); time.sleep(5 * (attempt + 1))
sys.exit("could not fetch the WMA boundary from AGFC or the AR GIS Office mirror")
