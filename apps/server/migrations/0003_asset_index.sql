-- Find the card(s) using an image, to decide whether a share link may show it.
CREATE INDEX objects_asset ON objects(json_extract(data, '$.content.assetId'));
