-- Asset -> pack lookup, so image requests stop unpacking every pack manifest.
-- Triggers keep it in step with sticker_packs.manifest; updates only write rows that changed.
CREATE TABLE sticker_assets (asset_id TEXT NOT NULL, pack_name TEXT NOT NULL, available INTEGER NOT NULL, PRIMARY KEY (asset_id, pack_name)) WITHOUT ROWID;
CREATE INDEX sticker_assets_pack ON sticker_assets(pack_name);
CREATE TRIGGER sticker_assets_insert AFTER INSERT ON sticker_packs BEGIN
  INSERT OR REPLACE INTO sticker_assets (asset_id, pack_name, available)
    SELECT json_extract(value, '$.assetId'), NEW.name, MAX(COALESCE(json_extract(value, '$.available'), 0) = 1)
    FROM json_each(NEW.manifest, '$.stickers') WHERE json_extract(value, '$.assetId') IS NOT NULL GROUP BY 1;
END;
CREATE TRIGGER sticker_assets_update AFTER UPDATE OF manifest ON sticker_packs BEGIN
  DELETE FROM sticker_assets WHERE pack_name = NEW.name AND asset_id NOT IN (
    SELECT json_extract(value, '$.assetId') FROM json_each(NEW.manifest, '$.stickers') WHERE json_extract(value, '$.assetId') IS NOT NULL);
  INSERT OR REPLACE INTO sticker_assets (asset_id, pack_name, available)
    SELECT m.asset_id, NEW.name, m.available FROM (
      SELECT json_extract(value, '$.assetId') AS asset_id, MAX(COALESCE(json_extract(value, '$.available'), 0) = 1) AS available
      FROM json_each(NEW.manifest, '$.stickers') WHERE json_extract(value, '$.assetId') IS NOT NULL GROUP BY 1) m
    WHERE NOT EXISTS (SELECT 1 FROM sticker_assets x WHERE x.asset_id = m.asset_id AND x.pack_name = NEW.name AND x.available = m.available);
END;
INSERT INTO sticker_assets (asset_id, pack_name, available)
  SELECT json_extract(s.value, '$.assetId'), p.name, MAX(COALESCE(json_extract(s.value, '$.available'), 0) = 1)
  FROM sticker_packs p, json_each(p.manifest, '$.stickers') s WHERE json_extract(s.value, '$.assetId') IS NOT NULL GROUP BY 1, 2;
