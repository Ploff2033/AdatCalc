-- Одноразовый атомарный перенос зимних рецептов заводов «Джага» и «Теберда».
-- Запускать в production DB calc после выкладки кода seasonal-recipe-selection:
--   docker exec -i adat-calc-db psql -v ON_ERROR_STOP=1 -U calc calc < scripts/transfer-winter-recipes.sql
-- Скрипт проверяет исходные данные, создаёт Криопласт Альфа на каждом заводе
-- и 15/16 копий соответственно. Ошибка откатывает всю транзакцию.

BEGIN;

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
DECLARE
  plant_row RECORD;
  cryoplast_key TEXT;
  source_count INTEGER;
  p1_line_count INTEGER;
  cement_line_count INTEGER;
  expected_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('transfer-winter-recipes-all-plants'));

  IF (SELECT count(*) FROM plants WHERE name IN ('Джага', 'Теберда')) <> 2 THEN
    RAISE EXCEPTION 'Ожидались заводы «Джага» и «Теберда»';
  END IF;

  FOR plant_row IN
    SELECT id, name FROM plants WHERE name IN ('Джага', 'Теберда') ORDER BY name
  LOOP
    expected_count := CASE plant_row.name WHEN 'Джага' THEN 15 ELSE 16 END;

    SELECT count(DISTINCT r.id), count(*)
      INTO source_count, p1_line_count
      FROM recipes r
      JOIN recipe_items ri ON ri.recipe_id = r.id
      JOIN materials m ON m.id = ri.material_id
     WHERE r.plant_id = plant_row.id
       AND m.name = 'Добавка П1'
       AND r.name NOT LIKE '% Зима';

    IF source_count <> expected_count OR p1_line_count <> expected_count THEN
      RAISE EXCEPTION 'Для «%» ожидалось % исходных рецептов с одной строкой П1; найдено рецептов %, строк П1 %',
        plant_row.name, expected_count, source_count, p1_line_count;
    END IF;

    SELECT count(*) INTO cement_line_count
      FROM recipes r
      JOIN recipe_items ri ON ri.recipe_id = r.id
      JOIN materials m ON m.id = ri.material_id
     WHERE r.plant_id = plant_row.id
       AND m.name = 'Цемент'
       AND r.name NOT LIKE '% Зима'
       AND EXISTS (
         SELECT 1 FROM recipe_items p1i
         JOIN materials p1 ON p1.id = p1i.material_id
         WHERE p1i.recipe_id = r.id AND p1.name = 'Добавка П1'
       );
    IF cement_line_count <> expected_count THEN
      RAISE EXCEPTION 'Для «%» ожидалась одна строка цемента в каждом исходном рецепте; найдено %',
        plant_row.name, cement_line_count;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM recipes r
        JOIN recipe_items p1_item ON p1_item.recipe_id = r.id
        JOIN materials p1 ON p1.id = p1_item.material_id
       WHERE r.plant_id = plant_row.id
         AND p1.name = 'Добавка П1'
         AND r.name NOT LIKE '% Зима'
         AND (
           p1.unit <> 'кг'
           OR NOT EXISTS (
             SELECT 1
               FROM recipe_items cement_item
               JOIN materials cement ON cement.id = cement_item.material_id
              WHERE cement_item.recipe_id = r.id
                AND cement.name = 'Цемент'
                AND cement.unit = 'т'
           )
         )
    ) THEN
      RAISE EXCEPTION 'Для «%» ожидаются цемент в тоннах и П1 в килограммах', plant_row.name;
    END IF;

    IF EXISTS (SELECT 1 FROM recipes WHERE plant_id = plant_row.id AND name LIKE '% Зима') THEN
      RAISE EXCEPTION 'В «%» уже есть рецепты с суффиксом «Зима»; перенос отменён', plant_row.name;
    END IF;

    SELECT id INTO cryoplast_key
      FROM materials
     WHERE plant_id = plant_row.id AND name = 'Криопласт Альфа';

    IF cryoplast_key IS NOT NULL THEN
      IF (SELECT unit <> 'кг' OR price <> 53 FROM materials WHERE id = cryoplast_key) THEN
        RAISE EXCEPTION 'В «%» материал «Криопласт Альфа» уже есть, но единица или цена не равна кг / 53 ₽', plant_row.name;
      END IF;
    ELSE
      cryoplast_key := 'mat_winter_' || substr(md5(plant_row.id || '|Криопласт Альфа'), 1, 24);
      INSERT INTO materials (id, plant_id, name, unit, price)
      VALUES (cryoplast_key, plant_row.id, 'Криопласт Альфа', 'кг', 53);
    END IF;

    INSERT INTO recipes (id, plant_id, name, sale_price, is_active)
    SELECT 'rec_winter_' || substr(md5(plant_row.id || '|' || r.id || '|winter'), 1, 24),
           plant_row.id,
           r.name || ' Зима',
           r.sale_price,
           FALSE
      FROM recipes r
      JOIN recipe_items ri ON ri.recipe_id = r.id
      JOIN materials m ON m.id = ri.material_id
     WHERE r.plant_id = plant_row.id
       AND m.name = 'Добавка П1'
       AND r.name NOT LIKE '% Зима';

    INSERT INTO recipe_items (recipe_id, material_id, qty, position)
    SELECT 'rec_winter_' || substr(md5(plant_row.id || '|' || r.id || '|winter'), 1, 24),
           ri.material_id,
           ri.qty,
           ri.position
      FROM recipes r
      JOIN recipe_items ri ON ri.recipe_id = r.id
      JOIN materials m ON m.id = ri.material_id
     WHERE r.plant_id = plant_row.id
       AND m.name <> 'Добавка П1'
       AND r.name NOT LIKE '% Зима'
       AND EXISTS (
         SELECT 1 FROM recipe_items p1i
         JOIN materials p1 ON p1.id = p1i.material_id
         WHERE p1i.recipe_id = r.id AND p1.name = 'Добавка П1'
       );

    INSERT INTO recipe_items (recipe_id, material_id, qty, position)
    SELECT 'rec_winter_' || substr(md5(plant_row.id || '|' || r.id || '|winter'), 1, 24),
           cryoplast_key,
           ROUND(cement_item.qty * 17, 3),
           COALESCE((SELECT max(existing_item.position) + 1
                       FROM recipe_items existing_item
                      WHERE existing_item.recipe_id = r.id), 0)
      FROM recipes r
      JOIN recipe_items p1_item ON p1_item.recipe_id = r.id
      JOIN materials p1 ON p1.id = p1_item.material_id AND p1.name = 'Добавка П1'
      JOIN recipe_items cement_item ON cement_item.recipe_id = r.id
      JOIN materials cement ON cement.id = cement_item.material_id AND cement.name = 'Цемент'
     WHERE r.plant_id = plant_row.id
       AND r.name NOT LIKE '% Зима';

    RAISE NOTICE 'Завод %: подготовлено зимних рецептов: %', plant_row.name, expected_count;
  END LOOP;
END $$;

COMMIT;
