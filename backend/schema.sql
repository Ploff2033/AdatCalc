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
-- is_driver — отметка "может быть водителем", без отдельного справочника:
-- такой сотрудник появляется в выборе водителя при оформлении заказа/рейса
-- на Главной (см. путевой лист).
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  plant_id TEXT REFERENCES plants(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  salary NUMERIC NOT NULL,
  is_driver BOOLEAN NOT NULL DEFAULT FALSE,
  license_number TEXT NOT NULL DEFAULT ''
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
  urea_rate NUMERIC NOT NULL DEFAULT 0,
  platon_rate_per_km NUMERIC NOT NULL DEFAULT 0
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
  platon_cost_per_trip NUMERIC NOT NULL DEFAULT 0,
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
  universal_token_last_used_ip TEXT,
  company_requisites TEXT NOT NULL DEFAULT ''
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
ALTER TABLE mixers ADD COLUMN IF NOT EXISTS platon_rate_per_km NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platon_cost_per_trip NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE mixers ADD COLUMN IF NOT EXISTS license_plate TEXT NOT NULL DEFAULT '';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_driver BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS license_number TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_license_number TEXT NOT NULL DEFAULT '';
-- Снимки на момент заказа (см. комментарий у orders выше) — нужны путевому
-- листу: водитель и гос. номер миксера на момент рейса, а не текущие (могут
-- измениться в справочниках позже).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mixer_plate TEXT NOT NULL DEFAULT '';
-- Реквизиты организации для путевого листа (строка "Организация (наименование,
-- адрес и номер телефона)" на бланке 4-П) — общие на все заводы, не название
-- конкретного завода, поэтому в config, а не в plants.
ALTER TABLE config ADD COLUMN IF NOT EXISTS company_requisites TEXT NOT NULL DEFAULT '';

-- Путевые листы (форма 4-П) для заказов, рейсы которых физически растянуты
-- на несколько дней/машин/водителей — отдельно от заказа, потому что заказ
-- (см. sanitize() в handlers/orders.js) это неизменяемый снимок расчёта на
-- момент оформления с одним tripCount и одной датой, а по регламенту путевой
-- лист нужен на каждый рабочий день+машину+водителя отдельно. order_id
-- обязателен — рейсы всегда берутся из пула конкретного заказа (см.
-- handlers/waybill-entries.js: "осталось разнести" = orders.trip_count минус
-- сумма trip_count всех записей на этот заказ).
-- trip_date — текст 'YYYY-MM-DD', а не DATE/TIMESTAMPTZ, чтобы день не мог
-- сдвинуться при разборе часовым поясом (нужен только день, без времени).
CREATE TABLE IF NOT EXISTS waybill_entries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  plant_id TEXT NOT NULL,
  plant_name TEXT NOT NULL,
  trip_date TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  driver_license_number TEXT NOT NULL DEFAULT '',
  mixer_id TEXT NOT NULL,
  mixer_name TEXT NOT NULL,
  mixer_plate TEXT NOT NULL DEFAULT '',
  distance_km NUMERIC NOT NULL,
  trip_count NUMERIC NOT NULL,
  fuel_price_per_liter NUMERIC NOT NULL DEFAULT 0,
  fuel_cost_per_trip NUMERIC NOT NULL DEFAULT 0,
  -- Снимок order.address на момент разнесения — тот же принцип, что и у
  -- plant_id/plant_name выше: заказ мог позже измениться, путевой лист
  -- должен остаться таким, каким был напечатан.
  address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waybill_entries_order ON waybill_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_waybill_entries_driver_date ON waybill_entries(driver_id, trip_date);
CREATE INDEX IF NOT EXISTS idx_waybill_entries_mixer_date ON waybill_entries(mixer_id, trip_date);

-- Бюджеты времени для проверки путевых листов (см. handlers/waybill-entries.js):
-- сколько часов в сутки может быть в рейсах водитель/машина, и параметры
-- расчёта времени на рейс (расстояние туда-обратно / средняя скорость +
-- время разгрузки; погрузка на заводе отдельно не считается).
ALTER TABLE config ADD COLUMN IF NOT EXISTS driver_shift_hours NUMERIC NOT NULL DEFAULT 8;
ALTER TABLE config ADD COLUMN IF NOT EXISTS vehicle_shift_hours NUMERIC NOT NULL DEFAULT 16;
ALTER TABLE config ADD COLUMN IF NOT EXISTS avg_speed_kmh NUMERIC NOT NULL DEFAULT 60;
ALTER TABLE config ADD COLUMN IF NOT EXISTS unload_minutes NUMERIC NOT NULL DEFAULT 20;

-- Адрес доставки клиенту — печатается в путевом листе (форма №4-П, стр2,
-- поле "Маршрут движения") как "Название завода → адрес". У самовывоза
-- всегда пусто — маршрута доставки нет.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';

-- Начальный одометр машины (км) — точка отсчёта для расчётного пробега в
-- путевых листах формы №4-С (аудиторы требуют показания спидометра при
-- выезде/возвращении, но реального прибора у нас нет — см. обсуждение с
-- пользователем). НЕ мутируемый счётчик: значение вводится один раз вручную
-- на карточке машины и остаётся неизменным, а фактический "текущий одометр"
-- на любую дату всегда считается заново как
-- odometer_baseline_km + сумма (расстояние туда-обратно × кол-во рейсов)
-- по ВСЕМ путевым записям этой машины с датой/временем создания раньше —
-- см. buildWaybill4sDocuments() в router.js. Такой расчёт (а не хранимый
-- накопитель) не ломается при внесении исторических записей задним числом.
ALTER TABLE mixers ADD COLUMN IF NOT EXISTS odometer_baseline_km NUMERIC NOT NULL DEFAULT 0;

-- Цена топлива и мочевины — у каждого завода своя (раньше были общими в
-- config.fuel_price_default/urea_price_default). Бэкфилл из старых общих
-- значений выполняется ОДИН раз, в момент добавления колонок — иначе каждый
-- запуск перезаписывал бы осознанно выставленные заводам значения. Старые
-- колонки в config остаются в БД (не удаляем данные), но код их не читает.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'plants' AND column_name = 'fuel_price'
  ) THEN
    ALTER TABLE plants ADD COLUMN fuel_price NUMERIC NOT NULL DEFAULT 0;
    ALTER TABLE plants ADD COLUMN urea_price NUMERIC NOT NULL DEFAULT 0;
    UPDATE plants SET
      fuel_price = COALESCE((SELECT fuel_price_default FROM config WHERE id = 1), 0),
      urea_price = COALESCE((SELECT urea_price_default FROM config WHERE id = 1), 0);
  END IF;
END $$;

-- ==================== v2: модуль остатков (Фаза 2) ====================
-- Остаток материала на заводе — три числа прямо на карточке материала (у
-- каждого материала и так один plant_id, отдельная таблица складов не
-- нужна, см. план v2/redesign): физически на складе, сколько из него уже
-- забронировано под оформленные заказы, и порог, ниже которого шлём
-- уведомление. "Доступно" = stock_on_hand - stock_reserved, не хранится
-- отдельно, считается на лету.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS stock_on_hand NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS stock_reserved NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS stock_threshold NUMERIC NOT NULL DEFAULT 0;

-- order_materials — снимок расхода на момент заказа (имя/ед./кол-во текстом,
-- не живая ссылка, см. комментарий у самой таблицы) — но чтобы бронь/
-- списание в handlers/stock.js знали, КАКОЙ именно материал трогать, нужен
-- ещё и id. ON DELETE SET NULL (не CASCADE/RESTRICT) — если материал потом
-- удалят, старый заказ остаётся как был, просто эта позиция больше не
-- участвует в остатках (бронировать/списывать с несуществующего материала
-- нечего — handlers/stock.js молча пропускает такие строки).
ALTER TABLE order_materials ADD COLUMN IF NOT EXISTS material_id TEXT REFERENCES materials(id) ON DELETE SET NULL;

-- Журнал движений остатка — reserve (заказ оформлен) | writeoff (разнесён
-- путевой лист, знак минус к on_hand и reserved) | release (заказ отменён/
-- удалён — снимается ещё не списанный остаток брони) | receipt (приход) |
-- adjustment (ручная корректировка после инвентаризации). before/after
-- хранятся явно, а не считаются задним числом из суммы движений — так лог
-- самодостаточен и его можно просто вывести в ленту на экране "Остатки".
-- reserved_after - reserved_before, просуммированное по order_id, также
-- используется handlers/stock.js::release() как "сколько от брони этого
-- заказа ещё не списано" — так отмена корректно работает и для частично
-- отгруженных заказов, и повторный вызов ничего не ломает (даёт 0).
CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  on_hand_before NUMERIC NOT NULL,
  on_hand_after NUMERIC NOT NULL,
  reserved_before NUMERIC NOT NULL,
  reserved_after NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_material ON stock_movements(material_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_order ON stock_movements(order_id);

-- Дата отгрузки (из макета Main — отдельно от даты/времени оформления
-- заказа) и отметка отмены. cancelled_at, а не статус-колонка — заказ
-- остаётся в истории (не удаляется), просто с флагом; отличить "отменён"
-- от "удалён" можно по тому, есть ли вообще строка в orders. Отменить можно
-- только пока по заказу нет путевых листов (см. handlers/orders.js::cancel);
-- удалить (DELETE) — только admin (см. router.js).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Порог рентабельности (подсветка заказов ниже него в списке «Заказы») и
-- Telegram-токен/chat id — переезжают из .env в БД, чтобы админ мог менять
-- их из Настроек без доступа к серверу. backend/telegram.js читает сначала
-- эти колонки, при пустом значении — падает обратно на переменные
-- окружения (см. telegram.js), так что уже настроенные через .env боевые
-- деплои не ломаются, пока их явно не перенастроят через интерфейс.
ALTER TABLE config ADD COLUMN IF NOT EXISTS rentability_threshold_percent NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

-- ==================== v2: справочники Материалы/Смеси/Техника ====================
-- Ставка НДС закупки материала (0 по умолчанию = не меняет поведение уже
-- заведённых материалов — расчёт остаётся как был, пока админ явно не
-- укажет ставку). Входящий НДС по этой ставке принимается к вычету и не
-- является реальным расходом, в отличие от исходящего НДС с продажи смеси,
-- поэтому в себестоимости участвует цена БЕЗ него — см.
-- Calc.materialNetPrice в frontend/js/shared/calc.js (эта же логика уже
-- была сделана и проверена раньше в отдельной ветке fix/vat-material-rates,
-- сюда перенесена как есть, просто со вводом ставки обычным числовым полем
-- вместо сегмента 22/10/0 %).
ALTER TABLE materials ADD COLUMN IF NOT EXISTS vat_rate NUMERIC NOT NULL DEFAULT 0;

-- ==================== v2: настройки заводов (объединение в один раздел) ====================
-- Доплата водителю за рейс в соседний город — раньше была общей в
-- config.neighbor_city_surcharge, но по сути привязана к заводу (у разных
-- заводов разные соседние города и расстояния до них). Бэкфилл из старого
-- общего значения — ОДИН раз, в момент добавления колонки (тот же приём,
-- что и с fuel_price/urea_price выше), иначе каждый рестарт затирал бы то,
-- что админ явно выставил заводу. Старая колонка в config остаётся в БД
-- (данные не удаляем), но код её больше не читает.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'plants' AND column_name = 'neighbor_city_surcharge'
  ) THEN
    ALTER TABLE plants ADD COLUMN neighbor_city_surcharge NUMERIC NOT NULL DEFAULT 0;
    UPDATE plants SET
      neighbor_city_surcharge = COALESCE((SELECT neighbor_city_surcharge FROM config WHERE id = 1), 0);
  END IF;
END $$;

-- Материалы без учёта остатка (вода из водопровода, газ по трубе — их
-- физически "не может стать меньше" на складе). FALSE по умолчанию не
-- меняет поведение уже заведённых материалов. Бронь/списание/снятие брони
-- по заказам для такого материала просто не трогают числа (см.
-- handlers/stock.js::adjustMaterial) — остаток остаётся 0/0, порог теряет
-- смысл и не участвует в дефицитных предупреждениях (фронтенд/бэкенд
-- одинаково пропускают такие материалы при подсчёте дефицита).
ALTER TABLE materials ADD COLUMN IF NOT EXISTS stock_unlimited BOOLEAN NOT NULL DEFAULT FALSE;

-- ==================== v2: модуль клиентов ====================
-- Запрошено Капланом 25.09.2026 (см. документ "AdatBeton Calc v2 —
-- архитектура модулей"): справочник клиентов для понимания распределения
-- отгруженных объёмов. НЕ привязан к заводу (в отличие от материалов/
-- рецептов/сотрудников) — один и тот же клиент может заказывать с разных
-- заводов, поэтому отдельной колонки plant_id здесь нет.
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'individual', -- 'legal' (юрлицо) | 'individual' (физлицо)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- client_id — для фильтрации/группировки отчёта по клиенту; client_name/
-- client_type — снимок на момент заказа (тот же приём, что и с plant_name/
-- recipe_name/mixer_name выше — переименование или удаление клиента задним
-- числом не должно портить исторические заказы). ON DELETE SET NULL:
-- удаление клиента из справочника не трогает прошлые заказы, просто эта
-- позиция перестаёт быть связана с живой карточкой клиента (снимок имени
-- остаётся). DEFAULT '' у client_name/client_type — для уже существующих
-- заказов (клиент обязателен только для НОВЫХ, начиная с этой миграции;
-- старые заказы показываются в отчёте как "Без клиента").
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT '';

-- ==================== v2: модуль ДДС ====================
-- См. документ "AdatBeton Calc — ДДС и Дашборд (MVP)". Вносится теми же
-- работниками, что создают заказы, по той же токен-ссылке завода — поэтому
-- plant_id тут того же типа доступа, что и orders.plant_id (не своя роль,
-- а тот же токен-скоуп, см. handlers/cash-entries.js).
--
-- amount — ЗНАКОВАЯ величина (отрицательная = расход/отток, положительная
-- = доход/приток), а не всегда-положительная с отдельным полем знака: так
-- сторно считается тем же способом, что и обычная сумма — просто запись с
-- противоположным знаком от исходной, и "Сальдо" = честная SUM(amount) без
-- специального случая для сторно. type — по-прежнему хранится отдельно
-- (для фильтра "Расход/Доход" в админском журнале; у сторно — тип
-- сторнируемой записи, не новый третий тип).
--
-- occurred_at (DATE) — редактируемая "дата операции" из формы (по
-- умолчанию сегодня, из неё же строится группировка по дням в ленте).
-- inserted_at (TIMESTAMPTZ) — НЕ редактируется никогда, это и время в
-- колонке "Время" ленты, и опорная точка для окна редактирования (15-30
-- минут после создания, см. handlers/cash-entries.js) — разделены
-- специально, иначе правка даты задним числом сдвигала бы окно редактирования.
--
-- receipt_path — относительный путь к фото чека на диске (см.
-- backend/uploads.js), NULL если категория не требует чека или чек ещё не
-- прикреплён. order_id — только для дохода категории "Продажа бетона";
-- ON DELETE SET NULL — удаление заказа (админом) не должно ронять запись
-- ДДС, просто теряется живая ссылка на заказ (сумма/комментарий остаются).
-- storno_of_id — запись-сторно ссылается на то, что отменяет; у исходной
-- записи "сторнирована" вычисляется (есть ли запись со storno_of_id = её id),
-- отдельного флага не заводим, чтобы не рассинхронизировать.
CREATE TABLE IF NOT EXISTS cash_entries (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  receipt_path TEXT,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  occurred_at DATE NOT NULL DEFAULT CURRENT_DATE,
  storno_of_id TEXT REFERENCES cash_entries(id) ON DELETE SET NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_entries_plant ON cash_entries(plant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_inserted ON cash_entries(inserted_at DESC);

-- Автосинхронизация ДДС в Облако Mail.ru (по просьбе пользователя — "чтобы
-- данные отображались в облачной таблице"). У Облака Mail.ru нет публичного
-- API для записи в отдельные ячейки живой таблицы (в отличие от Google
-- Таблиц) — единственный официальный способ положить туда файл программно:
-- WebDAV, см. backend/mailru-webdav.js/mailru-sync.js. mailru_app_password —
-- НЕ обычный пароль от почты, а отдельный "пароль для внешних приложений"
-- (обязателен с 2022 года). Тот же приём, что и с Telegram-токеном выше —
-- секрет, видимый только admin (см. handlers/config.js).
ALTER TABLE config ADD COLUMN IF NOT EXISTS mailru_login TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS mailru_app_password TEXT;

-- ==================== v2: поступления инертных материалов + периоды работы водителей ====================
-- См. документ "AdatBeton Calc v2 — архитектура модулей" (обновление от
-- 30.09.2026): нужно восстановить (оценочно, для внутреннего аудита) рейсы
-- доставки инертных за 2025 год — учёт тогда не вёлся. Ведётся в отдельной
-- локальной ветке (v2/aggregate-receipts), не затрагивая живые остатки на
-- проде; заодно первая реальная нагрузочная проверка модуля путевых листов
-- на исторических данных.

-- Гос. номер инертовоза — раньше был только у миксеров (mixers.license_plate,
-- см. выше), теперь путевой лист печатается и на рейсы поступлений инертных.
ALTER TABLE aggregate_trucks ADD COLUMN IF NOT EXISTS license_plate TEXT NOT NULL DEFAULT '';

-- Периоды работы водителя — несколько на одного (не один диапазон): человек
-- мог увольняться и возвращаться, оба периода фиксируются отдельно, а не
-- затираются. end_date NULL = период ещё открыт (водитель работает по
-- сегодняшний день включительно — решение пользователя). При распределении
-- рейса на конкретную дату (см. handlers/waybill-entries.js) система жёстко
-- проверяет, попадает ли дата хотя бы в один период — ровно как дневной
-- лимит часов, не мягкое предупреждение (осознанное решение пользователя,
-- несмотря на то что у всех текущих водителей периодов пока нет ни одного —
-- ветка отдельная и не в проде, это ожидаемо).
CREATE TABLE IF NOT EXISTS employee_work_periods (
  id SERIAL PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE
);
CREATE INDEX IF NOT EXISTS idx_employee_work_periods_employee ON employee_work_periods(employee_id);

-- Поступление инертного материала на завод — снимок на момент оформления
-- (не живая ссылка), тот же принцип, что и у orders.recipe_name/mixer_name:
-- material_id может стать NULL (материал удалён), material_name остаётся.
-- Одна запись = один материал + один объём (как заказ на бетон — одна
-- позиция за раз; несколько материалов сразу — несколько отдельных
-- поступлений, см. документ). truck_id/truck_name — техника, по чьей
-- грузоподъёмности считается trip_count при оформлении; сами рейсы при
-- разнесении могут пойти на любую другую технику — тот же принцип, что и с
-- mixer_name у заказа (источник числа рейсов при оформлении, не жёсткая
-- привязка каждого фактического рейса).
CREATE TABLE IF NOT EXISTS material_receipts (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE RESTRICT,
  plant_name TEXT NOT NULL,
  material_id TEXT REFERENCES materials(id) ON DELETE SET NULL,
  material_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  truck_id TEXT NOT NULL,
  truck_name TEXT NOT NULL,
  distance_km NUMERIC NOT NULL,
  trip_count NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_material_receipts_plant ON material_receipts(plant_id, created_at DESC);

-- Путевые листы теперь распределяют рейсы ИЛИ с заказа на бетон, ИЛИ с
-- поступления инертных — тем же самым механизмом и той же формой (документ
-- явно требует: "тот же экран, та же логика лимитов, никакой отдельной
-- ветки кода на распределение"). order_id стал необязательным, добавлен
-- receipt_id — CHECK гарантирует, что задан ровно один источник.
-- mixer_id/mixer_name/mixer_plate используются и для рейсов поступлений —
-- туда пишется id/имя/номер инертовоза (по факту это "техника рейса", а не
-- обязательно миксер конкретно; не переименовывали, чтобы не трогать все
-- существующие записи и печатные формы путевых листов).
ALTER TABLE waybill_entries ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE waybill_entries ADD COLUMN IF NOT EXISTS receipt_id TEXT REFERENCES material_receipts(id) ON DELETE CASCADE;
ALTER TABLE waybill_entries DROP CONSTRAINT IF EXISTS waybill_entries_source_check;
ALTER TABLE waybill_entries ADD CONSTRAINT waybill_entries_source_check
  CHECK ((order_id IS NOT NULL AND receipt_id IS NULL) OR (order_id IS NULL AND receipt_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_waybill_entries_receipt ON waybill_entries(receipt_id);

-- Журнал остатков (stock_movements) тоже должен уметь ссылаться на
-- поступление, не только на заказ — иначе движение "receipt" от разнесения
-- путевого листа поступления теряло бы, из-за какой именно записи оно
-- возникло (см. handlers/stock.js).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS receipt_id TEXT REFERENCES material_receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_receipt ON stock_movements(receipt_id);

-- Дата поступления "для бухгалтерии" — отдельно от created_at (момент
-- оформления записи в системе). Нужна, чтобы приход можно было отнести к
-- нужному месяцу задним числом (запись вносится позже, чем реально пришла
-- машина) — created_at для этого не годится, он не редактируется и не
-- переживает "оформили сегодня приход за 28-е число". DATE, не TIMESTAMPTZ
-- (только день имеет смысл, как и trip_date/ship_date в других таблицах).
ALTER TABLE material_receipts ADD COLUMN IF NOT EXISTS receipt_date DATE NOT NULL DEFAULT CURRENT_DATE;
CREATE INDEX IF NOT EXISTS idx_material_receipts_date ON material_receipts(receipt_date);

-- Адрес поставщика ("откуда везли") — печатная форма путевого листа (№4-С,
-- см. waybill-xlsx-4s.js) печатает waybill_entries.address как "откуда/куда"
-- для КАЖДОГО рейса; для заказов туда шёл orders.address (адрес доставки
-- клиенту), для поступлений раньше писалась пустая строка. Сохраняем на
-- самом поступлении (одном адресе на всю партию, как и qty/truck/distance),
-- validateAndBuild() в waybill-entries.js подставляет его в address так же,
-- как order.address для заказов.
ALTER TABLE material_receipts ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
