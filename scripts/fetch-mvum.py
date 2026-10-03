#!/usr/bin/env python3
"""Download USFS MVUM roads + trails around the Mount Magazine WMA into data/mvum.geojson.
Public domain USFS EDW data, no key. Needs shapely (e.g. /workspace/.venv-hunt/bin/python)."""
import json, os, time, urllib.request, urllib.parse
from shapely.geometry import shape, mapping
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVC = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer/{}/query"
wma = shape(json.load(open(os.path.join(ROOT, "data/wma-boundary.geojson")))["features"][0]["geometry"])
area = wma.buffer(0.003); W, S, E, N = area.bounds
F = "id,name,mvum_symbol_name,seasonal,passengervehicle,passengervehicle_datesopen,highclearancevehicle,highclearancevehicle_datesopen,atv,atv_datesopen,motorcycle,motorcycle_datesopen,surfacetype"
out = []
for layer, kind in ((1, "road"), (2, "trail")):
    q = dict(geometry=f"{W},{S},{E},{N}", geometryType="esriGeometryEnvelope", inSR=4326, where="1=1",
             outFields="*", outSR=4326, f="json", geometryPrecision=6, maxAllowableOffset=0.00002)
    d = json.load(urllib.request.urlopen(SVC.format(layer) + "?" + urllib.parse.urlencode(q), timeout=120))
    if "features" not in d: raise SystemExit("MVUM query failed: %s" % d)
    for f in d["features"]:
        paths = (f.get("geometry") or {}).get("paths")
        if not paths: continue
        g = shape({"type": "MultiLineString", "coordinates": paths})
        if not g.intersects(area): continue
        keep = F.split(","); p = {k: v for k, v in f["attributes"].items() if k in keep and v not in (None, "", " ")}
        p["kind"] = kind
        out.append({"type": "Feature", "geometry": mapping(g), "properties": p})
    time.sleep(0.5)
json.dump({"type": "FeatureCollection", "_fetched": time.strftime("%Y-%m-%d"), "features": out},
          open(os.path.join(ROOT, "data/mvum.geojson"), "w"), separators=(",", ":"))
print("wrote", len(out))
