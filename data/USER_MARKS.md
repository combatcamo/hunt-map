# User marks for Hunt Scout

Phone app (More → Import / export) can hand Scout GeoJSON files. Nothing is cloud-synced.

## Water marks — `user_water.geojson`

- **Download name:** `user_water.geojson` (More → **Export water marks (GeoJSON)**)
- **Scout inbox (box):** `/workspace/hunt-scout/inbox/user_water.geojson`
- **Atomic writer:** `scripts/write-inbox-geojson.py user_water.geojson < file`
- **Format:** GeoJSON `FeatureCollection` of `Point` features
- **Properties:**
  - `id` (string, e.g. `water-…`)
  - `name` (string, may be empty / auto “Water N”)
  - `type`: `"water"`
  - `notes` (string)
  - `updated` (ISO date `YYYY-MM-DD`)
  - `source`: `"user"`
- **Coordinates:** `[lon, lat]` (EPSG:4326)
- Also included in full pins JSON: `hunt-map-pins-YYYY-MM-DD.json` → `{ app, kind:"pins", version:1, pins:[…] }` where `pins[].type === "water"`.

## Food pins — `user_food.geojson`

- **Download name:** `user_food.geojson` (More → **Export food pins (GeoJSON)**)
- **Scout inbox (box):** `/workspace/hunt-scout/inbox/user_food.geojson`
- **Atomic writer:** `scripts/write-inbox-geojson.py user_food.geojson < file`
- **Format:** GeoJSON `FeatureCollection` of `Point` features (polygons later)
- **Properties:**
  - `id`, `name`, `type`: `"food"`, `notes`, `updated`, `source`: `"user"`
  - `food_type`: one of `food_plot | ag_field | oak_flat | mast_tree | clearcut | browse | orchard | other`
    - **Not** `mineral` — mineral/bait is never a food_type; UI shows AGFC caution if notes mention mineral/bait
  - `crop` (optional free text)
  - `status`: `planted | growing | mature | grazed_down | unknown` (default `unknown`)
- Also in full pins export (`type === "food"`).

## Example (food)

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "geometry": { "type": "Point", "coordinates": [-93.635, 35.175] },
    "properties": {
      "id": "food-xxx",
      "name": "Oak flat north",
      "type": "food",
      "food_type": "oak_flat",
      "crop": "",
      "status": "mature",
      "notes": "",
      "updated": "2026-10-05",
      "source": "user"
    }
  }]
}
```
