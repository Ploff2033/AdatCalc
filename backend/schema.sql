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
-- по ВСЕМ более ранним путевым записям этой машины в порядке рейсов
-- (дата → смены водителей → время создания записи) — см. buildVehicleDocs
-- в waybill-docs.js. Такой расчёт (а не хранимый
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
-- отгруженных объёмов. Изначально НЕ был привязан к заводу ("один клиент
-- может заказывать с разных заводов") — это решение заменено change
-- client-list (14.10.2026): заводы в 100+ км друг от друга, бетон столько не
-- живёт, общих клиентов нет. Привязка — clients.plant_id ниже, в разделе
-- "память клиента".
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

-- Адрес завода (физический, "откуда" для путевого листа) — по просьбе
-- пользователя: "в путевом пишется просто 'Джага', нужен нормальный адрес".
-- Печатная форма №4-С (waybill-xlsx-4s.js) раньше подставляла в "пункт
-- погрузки" только plants.name — нечитаемо для реального документа.
-- Правится в Настройках → Заводы, необязательное поле (пустая строка —
-- печатается по-старому, одно название, обратная совместимость).
ALTER TABLE plants ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';

-- Инертовозам — тот же набор полей, что и миксерам ("для инертовозов нужны
-- все те же поля, что и для миксеров, а то одометр на них нельзя
-- настроить"). mixers.odometer_baseline_km уже участвует в расчёте одометра
-- путевого листа (сейчас — buildVehicleDocs в waybill-docs.js) — до этой правки
-- тот расчёт читал базовый пробег ТОЛЬКО из mixers, так что для рейсов
-- поступлений (mixer_id там хранит id инертовоза, см. комментарий у
-- waybill_entries.receipt_id) он всегда считался нулевым, даже если бы поле
-- на инертовозе где-то и было — его читать было неоткуда. Теперь базовый
-- пробег читается из обеих таблиц, см. loadVehicleDocs в waybill-docs.js.
ALTER TABLE aggregate_trucks ADD COLUMN IF NOT EXISTS odometer_baseline_km NUMERIC NOT NULL DEFAULT 0;

-- Начало смены (минут от полуночи, 540 = 9:00) — "выезд с парковки условно
-- в 9". Используется только для печати путевого листа №4-С (время выезда/
-- возвращения в гараж + последовательность выполнения задания на обороте,
-- см. buildVehicleDocs в waybill-docs.js; это выезд ПЕРВОГО водителя дня,
-- следующий водитель той же машины принимает её в момент возвращения
-- предыдущего, change waybill-fuel-chain) — НЕ участвует в проверке
-- дневного лимита часов водителя/машины (та считает только суммарные часы,
-- не привязываясь к часам суток, см. handlers/waybill-entries.js).
ALTER TABLE config ADD COLUMN IF NOT EXISTS shift_start_minutes NUMERIC NOT NULL DEFAULT 540;

-- Номера путевых листов — по просьбе пользователя ("у путевых листов
-- должны быть номера"). Сами документы №4-С не хранятся как отдельная
-- сущность — собираются на лету при каждой выгрузке из waybill_entries
-- (группировка водитель+машина+дата, разбивка по 3 поездки, см.
-- buildVehicleDocs в waybill-docs.js), поэтому номер выдаётся и
-- запоминается по стабильному ключу документа (doc_key = та же строка,
-- что уже служит его id — "водитель-машина-дата-pN") — один раз при первой
-- выгрузке, дальше переживает повторную печать тех же рейсов. SERIAL — не
-- хронология рейсов, а порядок первого запроса печати.
CREATE TABLE IF NOT EXISTS waybill_doc_numbers (
  doc_key TEXT PRIMARY KEY,
  number SERIAL
);

-- Необязательная привязка записи ДДС к сотруднику/технике (категории "ЗП" и
-- "Топливо") — по просьбе пользователя, чтобы не писать имя/гос.номер в
-- комментарии руками. Ровно одна из mixer_id/aggregate_truck_id заполняется
-- за раз (техника завода — это либо миксер, либо инертовоз, общей таблицы
-- техники нет), employee_id — независимо от них. ON DELETE SET NULL, как и
-- у order_materials.material_id — удаление сотрудника/техники не трогает
-- старые записи ДДС, просто привязка пропадает, сам комментарий остаётся.
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS mixer_id TEXT REFERENCES mixers(id) ON DELETE SET NULL;
ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS aggregate_truck_id TEXT REFERENCES aggregate_trucks(id) ON DELETE SET NULL;

-- По просьбе пользователя — у сотрудника можно отдельно настроить, появляется
-- ли он в списке выбора для ДДС (категория "ЗП", см. employee_id выше), не
-- трогая сам факт его существования/видимость в Персонале/Путевых листах.
-- DEFAULT TRUE — существующие сотрудники продолжают появляться как раньше,
-- пока админ явно не скроет кого-то (например, уволенного, которого рано
-- удалять из-за истории расчётов).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS show_in_cash BOOLEAN NOT NULL DEFAULT TRUE;

-- "Другое" — по просьбе пользователя: техника, которая не возит груз по
-- дорогам (погрузчики и т.п.), поэтому не нужен весь набор полей
-- мик­серов/инертовозов (грузоподъёмность, амортизация, расход топлива на
-- 100 км, Платон, одометр для путевых листов — всё это не имеет смысла для
-- погрузчика). Только имя и гос.номер (необязательно) — чтобы просто можно
-- было выбрать такую технику в "Топливо" в ДДС (см. vehicleOptions() в
-- screen-cash.js/mobile-cash.js), без участия в себестоимости/путевых листах.
CREATE TABLE IF NOT EXISTS other_equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  license_plate TEXT NOT NULL DEFAULT ''
);

ALTER TABLE cash_entries ADD COLUMN IF NOT EXISTS other_equipment_id TEXT REFERENCES other_equipment(id) ON DELETE SET NULL;

-- Прицепы — по просьбе пользователя: тот же набор полей, что у миксера/
-- инертовоза (грузоподъёмность, амортизация, гос.номер, гаражный номер),
-- БЕЗ расхода топлива/мочевины/Платона и одометра — прицеп не жжёт топливо
-- сам (нет двигателя) и не имеет собственного пробега для путевого листа
-- (считается по технике, которая его тащит).
CREATE TABLE IF NOT EXISTS trailers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0,
  residual NUMERIC NOT NULL DEFAULT 0,
  mileage NUMERIC NOT NULL DEFAULT 0,
  license_plate TEXT NOT NULL DEFAULT '',
  garage_number TEXT NOT NULL DEFAULT ''
);

-- Гаражные номера — по просьбе пользователя, у всей техники (внутренняя
-- нумерация парка, отдельная от гос.номера).
ALTER TABLE mixers ADD COLUMN IF NOT EXISTS garage_number TEXT NOT NULL DEFAULT '';
ALTER TABLE aggregate_trucks ADD COLUMN IF NOT EXISTS garage_number TEXT NOT NULL DEFAULT '';
ALTER TABLE other_equipment ADD COLUMN IF NOT EXISTS garage_number TEXT NOT NULL DEFAULT '';

-- Прицеп на рейсе путевого листа — необязательный, снимок на момент
-- распределения (тот же принцип, что у mixer_name/mixer_plate в
-- waybill_entries выше: источник мог быть позже изменён/удалён, путевой
-- лист остаётся таким, каким был напечатан).
ALTER TABLE waybill_entries ADD COLUMN IF NOT EXISTS trailer_id TEXT REFERENCES trailers(id) ON DELETE SET NULL;
ALTER TABLE waybill_entries ADD COLUMN IF NOT EXISTS trailer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE waybill_entries ADD COLUMN IF NOT EXISTS trailer_plate TEXT NOT NULL DEFAULT '';

-- ==================== Реестр оплат (change reestr-oplat) ====================
-- Заявки на оплату для учредителя: admin заводит заявку, учредитель (по
-- своей токен-ссылке, config.owner_token) принимает решение, admin вносит
-- фактические оплаты. Сам платёж — вне системы (бухгалтер, банк).
-- Модуль самостоятельный: ни с ДДС (cash_entries), ни с plants/employees/
-- clients не связан (решение пользователя — "два разных процесса").

-- Справочники реестра — свои, не plants и не категории ДДС (у тех свои
-- правила, см. cash-entries.js::categoriesFor). hidden — "скрыто из выбора":
-- использованное значение не удаляется, а скрывается (старые заявки
-- продолжают его показывать). Уникальность — без учёта регистра.
CREATE TABLE IF NOT EXISTS pay_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_categories_name ON pay_categories (lower(name));

CREATE TABLE IF NOT EXISTS pay_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_units_name ON pay_units (lower(name));

-- Статус заявки НЕ хранится — вычисляется из decision/approved_amount и
-- суммы оплат (backend/registry-calc.js::computeState), тот же принцип,
-- что и "сторнирована" у cash_entries: иначе рассинхрон при удалении
-- оплаты или правке "К оплате". decision: NULL (ожидает решения) |
-- 'approved' | 'rejected' | 'postponed'.
-- seq — сквозной номер (SERIAL: удалённый номер повторно не выдаётся),
-- number = 'DDMMYY-seq' — фиксируется при создании и при правках не меняется.
CREATE TABLE IF NOT EXISTS pay_requests (
  id TEXT PRIMARY KEY,
  seq SERIAL UNIQUE,
  number TEXT NOT NULL UNIQUE,
  unit_id TEXT NOT NULL REFERENCES pay_units(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES pay_categories(id) ON DELETE RESTRICT,
  applicant TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL,
  purpose TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  due_date DATE,
  decision TEXT CHECK (decision IN ('approved', 'rejected', 'postponed')),
  approved_amount NUMERIC(14,2),
  decision_comment TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pay_requests_created ON pay_requests(created_at DESC);

-- ON DELETE RESTRICT — заявку с оплатами удалить нельзя (спека: сначала
-- удалить оплаты), а не каскадом молча.
CREATE TABLE IF NOT EXISTS pay_payments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES pay_requests(id) ON DELETE RESTRICT,
  paid_on DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pay_payments_request ON pay_payments(request_id);

-- Файлы заявки (payment_id IS NULL) и платёжки (payment_id задан, не
-- больше одной на оплату). stored_name — 128 бит случайности + расширение,
-- лежит в uploads/registry/, отдаётся без входа (ссылки из Excel у
-- бухгалтера); original_name — то, что показывается в интерфейсе.
-- Каскады удаляют строки, сами файлы на диске удаляет код (registry-files.js).
CREATE TABLE IF NOT EXISTS pay_files (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES pay_requests(id) ON DELETE CASCADE,
  payment_id TEXT REFERENCES pay_payments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'contract', 'payment_order', 'other')),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pay_files_request ON pay_files(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_files_payment ON pay_files(payment_id) WHERE payment_id IS NOT NULL;

-- Ссылка учредителя (/v2/?owner=<token>) и отдельный Telegram-чат реестра
-- (бот тот же, что у заказов — telegram_bot_token). Секреты — видит только admin.
ALTER TABLE config ADD COLUMN IF NOT EXISTS owner_token TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_registry_chat_id TEXT;

-- Прокси для исходящих запросов к api.telegram.org — найденный пользователем
-- реальный случай: с части серверов (РФ-хостинг) Telegram недоступен
-- напрямую на уровне TCP (TCP SYN до 443 не проходит ни из контейнера, ни с
-- хоста — не баг кода, подтверждено диагностикой). http(s)://user:pass@host:port
-- или socks5://user:pass@host:port — схема URL определяет тип (см.
-- telegram.js::proxyAgentFor). Пусто — прямое соединение, как раньше.
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_proxy_url TEXT;

-- ==================== Память клиента (change client-list) ====================
-- Клиент привязан к одному заводу. plant_id NULL = "Без завода": так после
-- выкатки остаются все существующие клиенты (данные НЕ переносятся —
-- назначение завода и память вносятся вручную или первым заказом). Колонка
-- намеренно без NOT NULL. ON DELETE RESTRICT — завод с клиентами не
-- удаляется (понятный 409 — в handlers/plants.js::remove).
--
-- Условия клиента — то, что подставляется в форму заказа и перезаписывается
-- каждым оформленным заказом ("оператор — первая инстанция") или правкой в
-- CRM. NULL у км/цены доставки/загрузки = "не задано" (не путать с 0).
-- max_load_m3 — ОГРАНИЧЕНИЕ загрузки миксера (сложный подъезд), а не
-- вместимость: NULL = по вместимости миксера.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS plant_id TEXT REFERENCES plants(id) ON DELETE RESTRICT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vat_gross BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS site_address TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS site_distance_km NUMERIC;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS site_neighbor_city BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS delivery_charge_per_m3 NUMERIC;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS self_pickup BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS mixer_id TEXT REFERENCES mixers(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS max_load_m3 NUMERIC;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS terms_updated_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS terms_source TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_plant ON clients(plant_id);
-- Разовые покупатели (общий клиент вроде «Физлицо»): без завода и без памяти —
-- виден на всех заводах, заказ не назначает ему завод и не пишет память
-- (иначе следующему физлицу подставлялся бы чужой объект), цены в CRM не ставятся.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS walk_in BOOLEAN NOT NULL DEFAULT FALSE;

-- Цена клиента по рецепту (без НДС): одна на пару клиент × рецепт, последняя
-- запись побеждает. Рецепт — по id (переименование цену сохраняет), удаление
-- рецепта или клиента удаляет строку. source_label — для показа в CRM
-- ("Заказ · Завод 1" / "CRM · manager").
CREATE TABLE IF NOT EXISTS client_prices (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  price_net NUMERIC NOT NULL CHECK (price_net >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('order', 'crm')),
  source_label TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (client_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS idx_client_prices_recipe ON client_prices(recipe_id);

-- Снимок загрузки миксера, по которой посчитаны рейсы заказа — только если
-- она МЕНЬШЕ вместимости (ограничение подъезда), иначе NULL (и у всех старых
-- заказов). По нему же решается строка "Рейсов: N × X м³" в Telegram.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS max_load_m3 NUMERIC;

-- Гаражные номера — снимок на момент распределения рейса, тот же принцип,
-- что у mixer_name/mixer_plate/trailer_name/trailer_plate выше: печатаются
-- в путевом листе №4-С (см. waybill-xlsx-4s.js), найдено пользователем как
-- пропуск — поле "Гаражный номер" в бланке есть, но ничего туда не попадало.
ALTER TABLE waybill_entries ADD COLUMN IF NOT EXISTS mixer_garage_number TEXT NOT NULL DEFAULT '';
ALTER TABLE waybill_entries ADD COLUMN IF NOT EXISTS trailer_garage_number TEXT NOT NULL DEFAULT '';

-- Разовый бэкфилл для записей, созданных ДО этих колонок — иначе у них
-- гаражный номер остался бы пустым навсегда (снимок пишется только в
-- момент создания/изменения записи, см. validateAndBuild в
-- handlers/waybill-entries.js), хотя в карточке техники он есть. Условие
-- "= ''" делает апдейт безопасным при повторном запуске (идемпотентно) —
-- не трогает записи, где поле уже заполнено (как нормальным снимком, так и
-- этим же бэкфиллом раньше).
UPDATE waybill_entries w SET mixer_garage_number = m.garage_number
  FROM mixers m WHERE w.mixer_id = m.id AND w.mixer_garage_number = '' AND m.garage_number <> '';
UPDATE waybill_entries w SET mixer_garage_number = t.garage_number
  FROM aggregate_trucks t WHERE w.mixer_id = t.id AND w.mixer_garage_number = '' AND t.garage_number <> '';
UPDATE waybill_entries w SET trailer_garage_number = tr.garage_number
  FROM trailers tr WHERE w.trailer_id = tr.id AND w.trailer_garage_number = '' AND tr.garage_number <> '';

-- Снимок ставки расхода техники (л/100км) на момент распределения рейса —
-- change waybill-fuel-chain. Норма топлива в путевом листе 4-С считается от
-- неё, а не обратным делением fuel_cost_per_trip на цену топлива завода
-- (при цене 0 норма раньше выходила 0). NULL — ещё не заполнено, код
-- трактует как 0.
ALTER TABLE waybill_entries ADD COLUMN IF NOT EXISTS fuel_rate NUMERIC;
-- Бэкфилл: где цена топлива была > 0 — точное восстановление ставки на
-- момент распределения (fuel_cost_per_trip = 2·км · ставка/100 · цена),
-- иначе — текущая ставка из карточки миксера/инертовоза. Идемпотентно.
UPDATE waybill_entries SET fuel_rate = fuel_cost_per_trip / (2 * distance_km * fuel_price_per_liter) * 100
  WHERE fuel_rate IS NULL AND fuel_price_per_liter > 0 AND distance_km > 0;
UPDATE waybill_entries w SET fuel_rate = m.fuel_rate
  FROM mixers m WHERE w.mixer_id = m.id AND w.fuel_rate IS NULL;
UPDATE waybill_entries w SET fuel_rate = t.fuel_rate
  FROM aggregate_trucks t WHERE w.mixer_id = t.id AND w.fuel_rate IS NULL;

-- Случайные коэффициенты топлива путевого листа 4-С (change
-- waybill-fuel-chain): выбираются один раз при первом расчёте листа и
-- больше не меняются, литры пересчитываются по полной истории техники.
-- doc_key — тот же ключ "водитель-техника-дата-pN", что у
-- waybill_doc_numbers, но таблица отдельная: номера выдаются только при
-- печати, а коэффициенты — и при расчёте сводки списания ГСМ.
-- target_p — целевой остаток после дозаправки в долях нормы (0.05…0.15),
-- start_s — стартовый остаток самого первого листа техники (0.05…0.10, у
-- остальных не нужен). Факт расхода не случаен — всегда равен норме.
CREATE TABLE IF NOT EXISTS waybill_doc_fuel (
  doc_key TEXT PRIMARY KEY,
  target_p NUMERIC NOT NULL,
  start_s NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Ранняя версия таблицы (до деплоя) хранила ещё отклонение факта — убрано.
ALTER TABLE waybill_doc_fuel DROP COLUMN IF EXISTS fact_k;

-- Исправление оформленных заказов (change order-edit). Заказ — не проводка:
-- правится на месте, след правки — журнал order_edits и сообщение в чат.
-- inserted_at — момент добавления заказа, не редактируется никогда: от него
-- считается суточное окно исправления для работника (created_at уже
-- правится менеджером, окно сдвигалось бы вместе с ним — тот же приём, что
-- cash_entries.inserted_at). Старые заказы получают inserted_at = created_at.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ;
UPDATE orders SET inserted_at = created_at WHERE inserted_at IS NULL;
ALTER TABLE orders ALTER COLUMN inserted_at SET DEFAULT now();
ALTER TABLE orders ALTER COLUMN inserted_at SET NOT NULL;
-- Снимки ссылок на рецепт/миксер — без FK, как recipe_name/mixer_name:
-- рецепт или миксер может быть удалён, заказ остаётся. NULL у заказов до
-- этого change — форма исправления ищет их по названию.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipe_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mixer_id TEXT;
-- Версия для отказа одновременных правок: растёт при каждом исправлении.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Журнал исправлений. changes — уже отформатированные строки
-- [{ field, label, before, after }] на момент правки (рецепт или клиента
-- потом могут переименовать — журнал показывает то, что было). Прибыль —
-- отдельно, в changes не входит. actor_role — 'worker' | 'manager' | 'admin'
-- (логинов нет, только роль), actor_plant_name — завод работника.
CREATE TABLE IF NOT EXISTS order_edits (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_role TEXT NOT NULL,
  actor_plant_name TEXT NOT NULL DEFAULT '',
  changes JSONB NOT NULL,
  profit_before NUMERIC NOT NULL,
  profit_after NUMERIC NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_edits_order ON order_edits(order_id, edited_at DESC);

-- Темы (Topics) внутри супергруппы "Заказы" (config.telegram_chat_id) — по
-- просьбе пользователя разнести уведомления о заказах и о дефиците
-- материалов по разным веткам одного чата, а не читать их общей лентой.
-- Пусто — сообщение идёт в чат без темы (общая лента), как раньше; это
-- значит фича не ломает уже настроенные боевые деплои без топиков.
-- Реестр оплат НЕ трогаем — у него уже свой отдельный чат
-- (telegram_registry_chat_id), пользователь явно оставил его отдельно.
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_orders_thread_id TEXT;
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_stock_thread_id TEXT;

-- ...по факту реестр оплат тоже переехал в тему той же супергруппы (не
-- отдельный чат, как предполагалось выше) — нужно то же поле темы, что и у
-- заказов/остатков. telegram_registry_chat_id при этом остаётся обычным
-- chat_id (без примеси ID темы через "/" — такое значение туда один раз
-- попало вручную через UI и было невалидным для Bot API, выглядело как
-- "-100.../4"; при деплое НЕ исправляем автоматически, разбор такого
-- значения неоднозначен в общем случае — просто у новой колонки тоже пусто
-- по умолчанию, донастраивается через интерфейс).
ALTER TABLE config ADD COLUMN IF NOT EXISTS telegram_registry_thread_id TEXT;
