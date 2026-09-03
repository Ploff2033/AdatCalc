-- Заводы: у каждого своя выработка/амортизация/коммуналка/локация.
-- access_token — секретный токен доступа для ссылки работника (?token=...),
-- заменяет прежний прямой id завода в URL; при "перевыпуске" перезаписывается,
-- что немедленно инвалидирует старую ссылку.
CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_output NUMERIC NOT NULL DEFAULT 0,
  depr_balance NUMERIC NOT NULL DEFAULT 0,
  depr_residual NUMERIC NOT NULL DEFAULT 0,
  depr_lifespan_months NUMERIC NOT NULL DEFAULT 0,
  utilities_monthly NUMERIC NOT NULL DEFAULT 0,
  location_lat DOUBLE PRECISION,
  location_lng DOUBLE PRECISION,
  access_token TEXT
);

-- Сотрудники: plant_id = NULL значит "общий" (на все заводы сразу).
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  plant_id TEXT REFERENCES plants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  salary NUMERIC NOT NULL
);

-- Техника — общая на все заводы.
CREATE TABLE IF NOT EXISTS mixers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity NUMERIC NOT NULL,
  balance NUMERIC NOT NULL,
  residual NUMERIC NOT NULL,
  mileage NUMERIC NOT NULL,
  fuel_rate NUMERIC NOT NULL,
  urea_rate NUMERIC NOT NULL DEFAULT 0
);

-- platon_rate_per_km — ставка «Платона» (₽/км), применяется только к доставке
-- инертных (аналог топлива, но без отдельной "цены" — сама ставка уже
-- полная, вводится один раз на карточке техники).
CREATE TABLE IF NOT EXISTS aggregate_trucks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity NUMERIC NOT NULL,
  balance NUMERIC NOT NULL,
  residual NUMERIC NOT NULL,
  mileage NUMERIC NOT NULL,
  fuel_rate NUMERIC NOT NULL,
  urea_rate NUMERIC NOT NULL DEFAULT 0,
  platon_rate_per_km NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  price NUMERIC NOT NULL,
  loss_percent NUMERIC NOT NULL DEFAULT 0,
  delivery_own_transport BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_truck_id TEXT REFERENCES aggregate_trucks(id) ON DELETE RESTRICT,
  delivery_distance_km NUMERIC NOT NULL DEFAULT 0,
  delivery_fuel_price_per_liter NUMERIC NOT NULL DEFAULT 0,
  delivery_urea_price_per_liter NUMERIC NOT NULL DEFAULT 0,
  delivery_driver_surcharge NUMERIC NOT NULL DEFAULT 0,
  delivery_manual_cost_per_unit NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sale_price NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id SERIAL PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  qty NUMERIC NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

-- Заказ — снимок расчёта на момент оформления (не живая ссылка на рецепт/технику),
-- поэтому текстовые поля plant_name/recipe_name/mixer_name, а не FK.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL,
  plant_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  recipe_name TEXT NOT NULL,
  mixer_name TEXT NOT NULL,
  sale_volume NUMERIC NOT NULL,
  distance_km NUMERIC NOT NULL,
  fuel_price_per_liter NUMERIC NOT NULL,
  urea_price_per_liter NUMERIC NOT NULL DEFAULT 0,
  urea_cost_per_trip NUMERIC NOT NULL DEFAULT 0,
  neighbor_city BOOLEAN NOT NULL DEFAULT FALSE,
  surcharge_per_trip NUMERIC NOT NULL,
  trip_count NUMERIC NOT NULL,
  round_trip_km NUMERIC NOT NULL,
  fuel_cost_per_trip NUMERIC NOT NULL,
  amort_cost_per_trip NUMERIC NOT NULL,
  delivery_cost_total NUMERIC NOT NULL,
  delivery_charge_per_m3 NUMERIC NOT NULL,
  delivery_revenue NUMERIC NOT NULL,
  delivery_profit NUMERIC NOT NULL,
  delivery_margin_percent NUMERIC NOT NULL,
  materials_cost NUMERIC NOT NULL,
  payroll_cost NUMERIC NOT NULL,
  depr_cost NUMERIC NOT NULL,
  utilities_cost NUMERIC NOT NULL,
  cost_per_m3 NUMERIC NOT NULL,
  sale_price NUMERIC NOT NULL,
  mix_revenue NUMERIC NOT NULL,
  mix_cost NUMERIC NOT NULL,
  mix_profit NUMERIC NOT NULL,
  mix_margin_percent NUMERIC NOT NULL,
  total_revenue NUMERIC NOT NULL,
  total_profit NUMERIC NOT NULL,
  profit_per_m3 NUMERIC NOT NULL,
  total_margin_percent NUMERIC NOT NULL,
  vat_applied BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS order_materials (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty NUMERIC NOT NULL
);

-- Общие настройки (одна строка) + хэши паролей.
-- universal_worker_token — общая ссылка "подмены": в отличие от plants.access_token
-- (закреплён за одним заводом), даёт обычный доступ уровня работника, но с
-- переключателем завода — чтобы один оператор мог подменить другого на время
-- отпуска/больничного без выдачи прав admin/manager.
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fuel_price_default NUMERIC NOT NULL DEFAULT 0,
  urea_price_default NUMERIC NOT NULL DEFAULT 0,
  neighbor_city_surcharge NUMERIC NOT NULL DEFAULT 0,
  admin_salt TEXT NOT NULL,
  admin_hash TEXT NOT NULL,
  manager_salt TEXT NOT NULL,
  manager_hash TEXT NOT NULL,
  universal_worker_token TEXT,
  universal_token_last_used_at TIMESTAMPTZ,
  universal_token_last_used_ip TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

-- История использования ссылок работника (по токену завода) — чтобы админ
-- видел, если токен вдруг стал использоваться из неожиданного места. Пишется
-- с троттлингом (не чаще раза в 10 минут на пару завод+IP) в handlers/plants.js.
CREATE TABLE IF NOT EXISTS plant_token_usage (
  id SERIAL PRIMARY KEY,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  ip TEXT,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_plant ON employees(plant_id);
CREATE INDEX IF NOT EXISTS idx_materials_plant ON materials(plant_id);
CREATE INDEX IF NOT EXISTS idx_recipes_plant ON recipes(plant_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items(recipe_id);
CREATE INDEX IF NOT EXISTS idx_orders_plant ON orders(plant_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_materials_order ON order_materials(order_id);
CREATE INDEX IF NOT EXISTS idx_plant_token_usage_plant ON plant_token_usage(plant_id, used_at DESC);

-- Точечные миграции для уже существующих таблиц (на новой БД — не действуют,
-- колонка уже есть из CREATE TABLE выше; на старой — добавляют недостающее).
ALTER TABLE plants ADD COLUMN IF NOT EXISTS access_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_plants_access_token ON plants(access_token) WHERE access_token IS NOT NULL;
ALTER TABLE config ADD COLUMN IF NOT EXISTS universal_worker_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS universal_token_last_used_at TIMESTAMPTZ;
ALTER TABLE config ADD COLUMN IF NOT EXISTS universal_token_last_used_ip TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vat_applied BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mixers ADD COLUMN IF NOT EXISTS urea_rate NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE aggregate_trucks ADD COLUMN IF NOT EXISTS urea_rate NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE aggregate_trucks ADD COLUMN IF NOT EXISTS platon_rate_per_km NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS delivery_urea_price_per_liter NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS urea_price_per_liter NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS urea_cost_per_trip NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE config ADD COLUMN IF NOT EXISTS urea_price_default NUMERIC NOT NULL DEFAULT 0;
