# User marks for Hunt Scout

The phone app (More → Export for Scout) can hand Scout GeoJSON files. Pins are saved on the phone first. Nothing is cloud-synced. The box-side helper is `scripts/write-inbox-geojson.py`.

All four inbox files are GeoJSON `FeatureCollection`s of `Point` features, coordinates `[lon, lat]` (EPSG:4326), `source: "user"`, and `added` (ISO timestamp).

## Water — `user_water.geojson`

- **Ids:** `w-…`
- **Properties:** `id`, `name`, `water_type`, `reliability`, `notes`, `added`, `source`
- **water_type:** `spring | seep | pond | creek_pool | wallow | tank | puddle | other`
- **reliability:** `year_round | seasonal | after_rain | unknown`

## Food — `user_food.geojson`

- **Ids:** `f-…`
- **Properties:** `id`, `name`, `food_type`, optional `crop`, `status`, `notes`, `added`, `source`
- **food_type:** `food_plot | ag_field | oak_flat | mast_tree | clearcut | browse | orchard | other | hard_mast | soft_mast | persimmon | mineral`
- **status:** `planted | growing | mature | grazed_down | unknown` (default `unknown`)
- **Mineral or bait:** features get a `legal_note` (minerals/bait may be illegal on WMAs) and do not raise stand ranks.

## Scrapes — `user_scrape.geojson`

- **Ids:** `s-…`
- **Properties:** `id`, `name`, `notes`, `added`, `source`
- **Optional:** `sign_date`, `freshness` (`fresh | active | old | unknown`), `size` (`large | medium | small | unknown`), `licking_branch` (boolean), `count`

## Rubs — `user_rub.geojson`

- **Ids:** `r-…`
- Same optionals as scrapes (`size` ≈ tree diameter hint).

## Box copy

```bash
scripts/write-inbox-geojson.py user_water.geojson --file ./user_water.geojson
scripts/write-inbox-geojson.py --dir ./exports   # any of the four files present
```

Writes atomically to `/workspace/hunt-scout/inbox/`. Then ping Hunt Scout to run `apply_user_pins.py`.
