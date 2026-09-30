(function () {
  // Персонал (макет Personnel.dc.html) — единственный справочник v2, доступ к
  // которому целиком завязан на роль admin, а не просто "просмотр
  // manager+/правка admin", как у Материалов/Техники: GET /api/employees сам
  // по себе отдаёт менеджеру только водителей без оклада/должности (см.
  // backend/handlers/employees.js::list) — при не-admin экран получил бы
  // урезанный, вводящий в заблуждение список. Поэтому весь роут
  // 'personnel' — admin (см. router.js::MIN_ROLE), и пункт меню скрыт для
  // остальных (см. shell.js::applyRoleVisibility), как и в v1
  // (auth-ui.js: tabButton('personnel').hidden = !isAtLeast('admin')).
  //
  // Настройки заводов (амортизация, коммуналка, целевая выработка), которые
  // в v1 жили тут же, во вкладке Персонала — в макете этого экрана их нет,
  // они переезжают в Настройки → Заводы отдельной задачей; здесь только
  // сотрудники.
  var HTML =
    '<div class="page-head"><div class="page-title-group"><span class="cap">Все заводы</span><h1>Персонал</h1></div><div class="page-head-actions"><button class="btn pri sm" id="pn-add-btn">Новый сотрудник</button></div></div>' +
    '<div id="pn-kpi-row" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px"></div>' +
    '<div class="ref-layout">' +
      '<div class="ref-main">' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
          '<div class="seg" role="group" aria-label="Фильтр" id="pn-filter-seg" style="width:440px"></div>' +
          '<input class="inp" id="pn-search" style="width:240px" placeholder="Поиск по ФИО" aria-label="Поиск по ФИО">' +
        '</div>' +
        '<section class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
          '<div class="row head" style="grid-template-columns:minmax(0,1.6fr) 120px 130px minmax(0,1.2fr) 44px"><div>Сотрудник</div><div>Завод</div><div class="r">Оклад</div><div>Путевые листы</div><div></div></div>' +
          '<div id="pn-groups"></div>' +
          '<p class="empty-state" id="pn-empty" hidden>Сотрудников не найдено.</p>' +
        '</section>' +
      '</div>' +
      '<aside class="drawer" id="pn-drawer" hidden>' +
        '<div class="drawer-head"><h2 id="pn-drawer-title">Новый сотрудник</h2><button type="button" class="btn ghost icon" id="pn-drawer-close" aria-label="Закрыть">✕</button></div>' +
        '<form id="pn-form">' +
          '<div class="drawer-body">' +
            '<div class="field"><label for="pn-f-name">ФИО</label><input id="pn-f-name" class="inp" required></div>' +
            '<div class="field"><label for="pn-f-position">Должность</label><input id="pn-f-position" class="inp" required></div>' +
            '<div class="field"><span style="font-size:12px;color:var(--ink-soft);font-weight:500">Завод</span><div class="seg" role="group" aria-label="Завод" id="pn-f-plant-seg"></div></div>' +
            '<div class="field"><label for="pn-f-salary">Оклад</label><div class="unit"><input id="pn-f-salary" class="inp num" inputmode="decimal"><span>₽/мес</span></div></div>' +
            '<label style="display:flex;align-items:center;justify-content:space-between;min-height:48px;padding:0 14px;border:1px solid var(--border-soft);border-radius:4px;background:#fff;cursor:pointer"><span style="font-weight:500">Водитель</span><button type="button" class="tog" id="pn-f-driver" aria-pressed="false"><i></i></button></label>' +
            '<div class="field" id="pn-f-license-field" hidden><label for="pn-f-license">Номер водительского удостоверения</label><input id="pn-f-license" class="inp num" inputmode="numeric"></div>' +
            '<div class="field" id="pn-f-periods-field" hidden>' +
              '<span style="font-size:12px;color:var(--ink-soft);font-weight:500">Периоды работы</span>' +
              '<p class="hint" style="margin:2px 0 8px">Рейс нельзя распределить на дату вне периода — без даты окончания период считается открытым (сотрудник работает по сей день).</p>' +
              '<div id="pn-periods-list" class="stack g6"></div>' +
              '<p class="hint" id="pn-periods-empty" style="margin:4px 0" hidden>Периодов пока нет — без них ни один рейс этого водителя не распределить.</p>' +
              '<p class="hint" id="pn-periods-unsaved" hidden>Сохраните сотрудника, затем добавьте периоды работы.</p>' +
              '<div id="pn-periods-add" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-top:8px">' +
                '<div class="field" style="margin:0"><label for="pn-f-period-start" style="font-size:11px">Начало</label><input id="pn-f-period-start" type="date" class="inp"></div>' +
                '<div class="field" style="margin:0"><label for="pn-f-period-end" style="font-size:11px">Окончание (необязательно)</label><input id="pn-f-period-end" type="date" class="inp"></div>' +
                '<button type="button" class="btn ghost sm" id="pn-period-add-btn">Добавить</button>' +
              '</div>' +
              '<p class="banner" id="pn-period-error" hidden></p>' +
            '</div>' +
          '</div>' +
          '<div class="drawer-foot">' +
            '<div class="spread" style="font-size:13px" id="pn-preview-total-row"><span style="color:var(--ink-soft)" id="pn-preview-total-label">ФОТ</span><span class="num" id="pn-preview-total">—</span></div>' +
            '<div class="spread" style="font-size:13px" id="pn-preview-per-m3-row"><span style="color:var(--ink-soft)" id="pn-preview-per-m3-label">ФОТ на 1 м³</span><span class="num" id="pn-preview-per-m3">—</span></div>' +
            '<p class="banner" id="pn-form-error" hidden></p>' +
            '<div style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px">' +
              '<button type="button" class="btn ghost" id="pn-delete-btn" style="color:#8C2217;border-color:#E3B8B1" hidden>Удалить</button>' +
              '<button type="submit" class="btn pri" id="pn-save-btn">Добавить сотрудника</button>' +
            '</div>' +
          '</div>' +
        '</form>' +
      '</aside>' +
    '</div>';

  var filterValue = 'all'; // 'all' | <plantId> | 'drivers'
  var searchValue = '';
  var editingEmployee = null; // полный объект редактируемого сотрудника, или null при создании
  var draftPlantId = ''; // '' — общий сотрудник, иначе id завода (выбор в форме)

  // Свой список сотрудников, а не State.data.employees — тот заведён под
  // Waybills (там driver-select должен видеть только текущий завод +
  // общих, поэтому state.js шлёт GET /api/employees?plantId=<текущий>, см.
  // shared/state.js::loadAll) и молча ограничивается одним заводом. Экрану
  // Персонала как раз нужен обратный эффект — все заводы сразу, без
  // привязки к тому, что выбрано в сайдбар-переключателе (это ролевой
  // список для admin, не привязан к "текущему заводу" по смыслу). Бэкенд
  // при GET /api/employees без ?plantId= отдаёт admin'у вообще всех (см.
  // handlers/employees.js::list) — этим и пользуемся.
  var allEmployees = [];
  async function loadEmployees() {
    try { allEmployees = await Api.get('/employees'); }
    catch (err) { allEmployees = []; }
  }

  function employees() { return allEmployees; }
  function plants() { return State.data.plants || []; }

  function plantName(plantId) {
    if (!plantId) return 'Общий';
    var p = plants().find(function (pl) { return pl.id === plantId; });
    return p ? p.name : 'Общий';
  }

  // ---- KPI-карточки: ФОТ на 1 м³ по каждому заводу + сводка по общим ----
  function renderKpis() {
    var row = document.getElementById('pn-kpi-row');
    var summary = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };
    var currentPlantId = Plant.currentPlantId();
    var cards = plants().map(function (p) {
      var perM3 = Calc.payrollPerM3(p, plants(), summary);
      var ownTotal = summary.byPlant[p.id] || 0;
      var sharedTotal = summary.sharedTotal || 0;
      var totalOutput = plants().reduce(function (s, pl) { return s + (pl.targetOutput || 0); }, 0);
      var sharedPerM3 = totalOutput > 0 ? sharedTotal / totalOutput : 0;
      var ownPerM3 = perM3 - sharedPerM3;
      var dark = p.id === currentPlantId;
      return '<div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:2px' + (dark ? ';background:var(--sidebar-bg);color:#fff;border-color:var(--sidebar-bg)' : '') + '">' +
        '<span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:' + (dark ? 'var(--sidebar-muted)' : 'var(--muted)') + '">ФОТ на 1 м³ · ' + p.name + '</span>' +
        '<span class="num" style="font-size:22px;font-weight:500;white-space:nowrap">' + Format.fmtNum(perM3, 0, '₽') + '</span>' +
        '<span class="num" style="font-size:12px;white-space:nowrap;color:' + (dark ? 'var(--sidebar-muted)' : 'var(--muted)') + '">' + Format.fmtNum(ownPerM3, 0, '₽') + ' свои + ' + Format.fmtNum(sharedPerM3, 0, '₽') + ' общие</span>' +
      '</div>';
    });
    var totalOutputAll = plants().reduce(function (s, pl) { return s + (pl.targetOutput || 0); }, 0);
    cards.push(
      '<div class="card" style="padding:14px 16px;display:flex;flex-direction:column;gap:2px">' +
        '<span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:var(--muted)">Общие сотрудники</span>' +
        '<span class="num" style="font-size:22px;font-weight:500;white-space:nowrap">' + Format.fmtNum(summary.sharedTotal || 0, 0, '₽/мес') + '</span>' +
        '<span class="num" style="font-size:12px;white-space:nowrap;color:var(--muted)">на ' + Format.fmtNum(totalOutputAll, 0, 'м³') + ' выработки всех заводов</span>' +
      '</div>'
    );
    row.innerHTML = cards.join('');
  }

  // ---- Фильтр (сегменты Все / <завод> ×N / Водители) ----
  function renderFilterSeg() {
    var seg = document.getElementById('pn-filter-seg');
    var all = employees();
    var buttons = [{ value: 'all', label: 'Все · ' + all.length }];
    plants().forEach(function (p) {
      buttons.push({ value: p.id, label: p.name + ' · ' + all.filter(function (e) { return e.plantId === p.id; }).length });
    });
    buttons.push({ value: 'drivers', label: 'Водители · ' + all.filter(function (e) { return e.isDriver; }).length });
    seg.innerHTML = buttons.map(function (b) {
      return '<button type="button" data-value="' + b.value + '" class="' + (b.value === filterValue ? 'on' : '') + '" aria-pressed="' + (b.value === filterValue) + '">' + b.label + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        filterValue = btn.dataset.value;
        renderFilterSeg();
        renderTable();
      });
    });
  }

  // ---- Список, сгруппированный по заводу (+ группа "Общие") ----
  function matchesSearch(e) {
    var q = searchValue.trim().toLowerCase();
    return !q || e.name.toLowerCase().indexOf(q) >= 0;
  }

  function buildGroups() {
    var all = employees();
    var summary = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };

    function group(label, plantId, bucket) {
      var full = bucket; // полный (без поиска) список — для сводки в шапке группы
      var shown = full.filter(matchesSearch);
      var plant = plantId ? plants().find(function (p) { return p.id === plantId; }) : null;
      var payrollTotal = plantId ? (summary.byPlant[plantId] || 0) : (summary.sharedTotal || 0);
      return { label: label, employees: shown, count: full.length, payrollTotal: payrollTotal, output: plant ? plant.targetOutput : null };
    }

    if (filterValue === 'drivers') {
      return [group('Водители', null, all.filter(function (e) { return e.isDriver; }))].filter(function (g) { return g.count > 0 || searchValue; });
    }
    if (filterValue !== 'all') {
      var p = plants().find(function (pl) { return pl.id === filterValue; });
      return [group(p ? p.name : 'Завод', filterValue, all.filter(function (e) { return e.plantId === filterValue; }))];
    }
    var groups = plants().map(function (p) {
      return group(p.name, p.id, all.filter(function (e) { return e.plantId === p.id; }));
    });
    groups.push(group('Общие · на все заводы', null, all.filter(function (e) { return !e.plantId; })));
    return groups.filter(function (g) { return g.count > 0; });
  }

  // "1 человек / 2 человека / 5 человек / 11 человек / 21 человек" — "человек"
  // само по себе неправильно склоняется как обычное слово (не "человеков"),
  // общее школьное правило для 11-14 и на "1"/"2-4"/остальное.
  function pluralHuman(n) {
    var mod100 = n % 100;
    var mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 14) return n + ' человек';
    if (mod10 === 1) return n + ' человек';
    if (mod10 >= 2 && mod10 <= 4) return n + ' человека';
    return n + ' человек';
  }

  function employeeRow(e) {
    return '<div class="row" style="grid-template-columns:minmax(0,1.6fr) 120px 130px minmax(0,1.2fr) 44px;min-height:56px;cursor:pointer" data-employee-id="' + e.id + '">' +
      '<div class="stack" style="gap:1px;min-width:0"><span style="font-weight:600">' + e.name + '</span><span class="hint">' + e.position + '</span></div>' +
      '<div>' + plantName(e.plantId) + '</div>' +
      '<div class="r num" style="font-weight:500">' + Format.fmtNum(e.salary, 0, '₽') + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;min-width:0">' + (e.isDriver ? '<span class="chip mute">Водитель</span><span class="num hint" style="white-space:nowrap">ВУ ' + (e.licenseNumber || '—') + '</span>' : '') + '</div>' +
      '<button type="button" class="btn ghost icon" style="width:36px;height:36px;padding:0" aria-label="Изменить сотрудника" data-employee-id="' + e.id + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>' +
    '</div>';
  }

  function renderTable() {
    var groups = buildGroups();
    var container = document.getElementById('pn-groups');
    document.getElementById('pn-empty').hidden = groups.some(function (g) { return g.employees.length > 0; });
    container.innerHTML = groups.map(function (g) {
      var meta = [pluralHuman(g.count), Format.fmtNum(g.payrollTotal, 0, '₽/мес')];
      if (g.output != null) meta.push('выработка ' + Format.fmtNum(g.output, 0, 'м³'));
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0 16px;height:40px;background:var(--surface-3);border-bottom:1px solid var(--border)">' +
          '<span style="font-weight:600">' + g.label + '</span><span class="num" style="font-size:12px;color:var(--ink-soft)">' + meta.join(' · ') + '</span>' +
        '</div>' +
        g.employees.map(employeeRow).join('');
    }).join('');
    Array.prototype.forEach.call(container.querySelectorAll('[data-employee-id]'), function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var emp = employees().find(function (e) { return e.id === el.dataset.employeeId; });
        if (emp) openForEdit(emp);
      });
    });
  }

  // ---- Форма (drawer) ----
  function renderPlantSeg() {
    var seg = document.getElementById('pn-f-plant-seg');
    var options = plants().map(function (p) { return { value: p.id, label: p.name }; });
    options.push({ value: '', label: 'Общий' });
    seg.innerHTML = options.map(function (o) {
      return '<button type="button" data-value="' + o.value + '" class="' + (o.value === draftPlantId ? 'on' : '') + '" aria-pressed="' + (o.value === draftPlantId) + '">' + o.label + '</button>';
    }).join('');
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        draftPlantId = btn.dataset.value;
        renderPlantSeg();
        updatePreview();
      });
    });
  }

  function applyDriverFieldVisibility() {
    var on = document.getElementById('pn-f-driver').classList.contains('on');
    document.getElementById('pn-f-license-field').hidden = !on;
    document.getElementById('pn-f-periods-field').hidden = !on;
    if (on) renderPeriods();
  }

  // ---- Периоды работы водителя (см. employee_work_periods в schema.sql) —
  // жёсткая блокировка на бэкенде (assertDriverWorkPeriod в
  // waybill-entries.js) требует period на дату рейса для ЛЮБОГО водителя,
  // так что без этой формы админ мог бы завести водителя, на которого
  // физически нельзя распределить ни один рейс, и узнать об этом только на
  // экране Путевых листов. Секция видна только пока включён тумблер
  // "Водитель" — периоды не водителя не используются нигде.
  function fmtPeriodDate(d) {
    if (!d) return '—';
    var parts = d.split('-');
    return parts.length === 3 ? parts[2] + '.' + parts[1] + '.' + parts[0] : d;
  }

  function renderPeriods() {
    var listEl = document.getElementById('pn-periods-list');
    var addBox = document.getElementById('pn-periods-add');
    var unsavedHint = document.getElementById('pn-periods-unsaved');
    if (!editingEmployee) {
      listEl.innerHTML = '';
      document.getElementById('pn-periods-empty').hidden = true;
      addBox.hidden = true;
      unsavedHint.hidden = false;
      return;
    }
    unsavedHint.hidden = true;
    addBox.hidden = false;
    var periods = (editingEmployee.workPeriods || []).slice().sort(function (a, b) { return a.startDate < b.startDate ? -1 : 1; });
    document.getElementById('pn-periods-empty').hidden = periods.length > 0;
    listEl.innerHTML = periods.map(function (p) {
      return '<div class="spread" style="padding:8px 10px;border:1px solid var(--border-soft);border-radius:4px" data-period-id="' + p.id + '">' +
        '<span class="num" style="font-size:13px">' + fmtPeriodDate(p.startDate) + ' — ' + (p.endDate ? fmtPeriodDate(p.endDate) : 'по наст. время') + '</span>' +
        '<button type="button" class="btn ghost icon pn-period-del-btn" style="width:28px;height:28px;padding:0" aria-label="Удалить период" title="Удалить период">✕</button>' +
      '</div>';
    }).join('');
    Array.prototype.forEach.call(listEl.querySelectorAll('.pn-period-del-btn'), function (btn) {
      btn.addEventListener('click', function () { handleDeletePeriod(btn.closest('[data-period-id]').dataset.periodId); });
    });
  }

  async function refreshEditingEmployee() {
    // Своя loadEmployees() держит только ЭТОТ экран в курсе (см. комментарий
    // у allEmployees выше) — но период работы нужен и другим экранам
    // (Путевые листы читают driver.workPeriods из общего State.data.employees,
    // см. screen-waybills.js::handleRangeSubmit), поэтому обновляем и общий
    // State тоже. Без этого водитель, только что получивший период тут,
    // выглядел бы "без периода" на Путевых листах до полной перезагрузки
    // страницы — реальный баг, а не гипотетический (SPA-переход между
    // экранами не перезагружает страницу и не трогает общий State сам по
    // себе).
    await Promise.all([loadEmployees(), State.loadAll()]);
    editingEmployee = employees().find(function (e) { return e.id === editingEmployee.id; }) || editingEmployee;
    renderPeriods();
    renderTable();
  }

  async function handleAddPeriod() {
    var errorEl = document.getElementById('pn-period-error');
    errorEl.hidden = true;
    var startDate = document.getElementById('pn-f-period-start').value;
    var endDate = document.getElementById('pn-f-period-end').value;
    if (!startDate) { errorEl.textContent = 'Укажите дату начала периода.'; errorEl.hidden = false; return; }
    try {
      await Api.post('/employees/' + editingEmployee.id + '/work-periods', { startDate: startDate, endDate: endDate || null });
      document.getElementById('pn-f-period-start').value = '';
      document.getElementById('pn-f-period-end').value = '';
      await refreshEditingEmployee();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDeletePeriod(periodId) {
    if (!confirm('Удалить период работы?')) return;
    try {
      await Api.del('/employees/' + editingEmployee.id + '/work-periods/' + periodId);
      await refreshEditingEmployee();
    } catch (err) { alert(err.message); }
  }

  // Симуляция: убираем старый оклад редактируемого сотрудника (если есть) из
  // его прежнего завода/общих и добавляем новый оклад в выбранный сейчас в
  // форме завод/общие — используется и для "до/после" в футере формы, и
  // нигде больше (реальное сохранение идёт через State.loadAll() после
  // Api.put/post, который пересчитает personnel-summary на бэкенде).
  function simulatedSummary() {
    var base = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };
    var byPlant = {};
    Object.keys(base.byPlant || {}).forEach(function (k) { byPlant[k] = base.byPlant[k]; });
    var sharedTotal = base.sharedTotal || 0;
    if (editingEmployee) {
      if (editingEmployee.plantId) byPlant[editingEmployee.plantId] = (byPlant[editingEmployee.plantId] || 0) - editingEmployee.salary;
      else sharedTotal -= editingEmployee.salary;
    }
    var newSalary = NumericInput.parseNumber(document.getElementById('pn-f-salary').value) || 0;
    if (draftPlantId) byPlant[draftPlantId] = (byPlant[draftPlantId] || 0) + newSalary;
    else sharedTotal += newSalary;
    return { byPlant: byPlant, sharedTotal: sharedTotal };
  }

  function updatePreview() {
    var base = State.data.personnelSummary || { byPlant: {}, sharedTotal: 0 };
    var after = simulatedSummary();
    if (draftPlantId) {
      var plant = plants().find(function (p) { return p.id === draftPlantId; });
      var beforeTotal = base.byPlant[draftPlantId] || 0;
      var afterTotal = after.byPlant[draftPlantId] || 0;
      var beforePerM3 = Calc.payrollPerM3(plant, plants(), base);
      var afterPerM3 = Calc.payrollPerM3(plant, plants(), after);
      document.getElementById('pn-preview-total-label').textContent = 'ФОТ ' + (plant ? plant.name : '');
      document.getElementById('pn-preview-total').textContent = Format.fmtNum(beforeTotal, 0, '₽') + ' → ' + Format.fmtNum(afterTotal, 0, '₽');
      document.getElementById('pn-preview-per-m3-label').textContent = 'ФОТ на 1 м³ · ' + (plant ? plant.name : '');
      document.getElementById('pn-preview-per-m3').textContent = Format.fmtNum(beforePerM3, 0, '₽') + ' → ' + Format.fmtNum(afterPerM3, 0, '₽');
    } else {
      var totalOutput = plants().reduce(function (s, p) { return s + (p.targetOutput || 0); }, 0);
      var beforeShared = base.sharedTotal || 0;
      var afterShared = after.sharedTotal;
      var beforePerM3Shared = totalOutput > 0 ? beforeShared / totalOutput : 0;
      var afterPerM3Shared = totalOutput > 0 ? afterShared / totalOutput : 0;
      document.getElementById('pn-preview-total-label').textContent = 'Общие сотрудники';
      document.getElementById('pn-preview-total').textContent = Format.fmtNum(beforeShared, 0, '₽/мес') + ' → ' + Format.fmtNum(afterShared, 0, '₽/мес');
      document.getElementById('pn-preview-per-m3-label').textContent = 'Наценка на 1 м³ · все заводы';
      document.getElementById('pn-preview-per-m3').textContent = Format.fmtNum(beforePerM3Shared, 0, '₽') + ' → ' + Format.fmtNum(afterPerM3Shared, 0, '₽');
    }
  }

  function openForCreate() {
    editingEmployee = null;
    draftPlantId = Plant.currentPlantId() || '';
    document.getElementById('pn-drawer-title').textContent = 'Новый сотрудник';
    document.getElementById('pn-save-btn').textContent = 'Добавить сотрудника';
    document.getElementById('pn-delete-btn').hidden = true;
    document.getElementById('pn-form-error').hidden = true;
    document.getElementById('pn-f-name').value = '';
    document.getElementById('pn-f-position').value = '';
    NumericInput.setFormattedValue(document.getElementById('pn-f-salary'), '');
    document.getElementById('pn-f-driver').classList.remove('on');
    document.getElementById('pn-f-driver').setAttribute('aria-pressed', 'false');
    LicenseInput.setValue(document.getElementById('pn-f-license'), '');
    document.getElementById('pn-f-period-start').value = '';
    document.getElementById('pn-f-period-end').value = '';
    document.getElementById('pn-period-error').hidden = true;
    applyDriverFieldVisibility();
    renderPlantSeg();
    updatePreview();
    document.getElementById('pn-drawer').hidden = false;
  }

  function openForEdit(emp) {
    editingEmployee = emp;
    draftPlantId = emp.plantId || '';
    document.getElementById('pn-drawer-title').textContent = 'Изменить сотрудника';
    document.getElementById('pn-save-btn').textContent = 'Сохранить';
    document.getElementById('pn-delete-btn').hidden = false;
    document.getElementById('pn-form-error').hidden = true;
    document.getElementById('pn-f-name').value = emp.name;
    document.getElementById('pn-f-position').value = emp.position;
    NumericInput.setFormattedValue(document.getElementById('pn-f-salary'), emp.salary);
    document.getElementById('pn-f-driver').classList.toggle('on', !!emp.isDriver);
    document.getElementById('pn-f-driver').setAttribute('aria-pressed', emp.isDriver ? 'true' : 'false');
    LicenseInput.setValue(document.getElementById('pn-f-license'), emp.licenseNumber || '');
    document.getElementById('pn-f-period-start').value = '';
    document.getElementById('pn-f-period-end').value = '';
    document.getElementById('pn-period-error').hidden = true;
    applyDriverFieldVisibility();
    renderPlantSeg();
    updatePreview();
    document.getElementById('pn-drawer').hidden = false;
  }

  function closeDrawer() { document.getElementById('pn-drawer').hidden = true; }

  async function handleSubmit(e) {
    e.preventDefault();
    var errorEl = document.getElementById('pn-form-error');
    errorEl.hidden = true;
    var isDriver = document.getElementById('pn-f-driver').classList.contains('on');
    var payload = {
      name: document.getElementById('pn-f-name').value.trim(),
      position: document.getElementById('pn-f-position').value.trim(),
      salary: NumericInput.parseNumber(document.getElementById('pn-f-salary').value) || 0,
      plantId: draftPlantId || null,
      isDriver: isDriver,
      licenseNumber: isDriver ? document.getElementById('pn-f-license').value.trim() : ''
    };
    if (!payload.name) { errorEl.textContent = 'Укажите ФИО.'; errorEl.hidden = false; return; }
    if (!payload.position) { errorEl.textContent = 'Укажите должность.'; errorEl.hidden = false; return; }
    try {
      if (editingEmployee) await Api.put('/employees/' + editingEmployee.id, payload);
      else await Api.post('/employees', payload);
      await Promise.all([State.loadAll(), loadEmployees()]);
      closeDrawer();
      render();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  }

  async function handleDelete() {
    if (!editingEmployee) return;
    if (!confirm('Удалить сотрудника «' + editingEmployee.name + '»?')) return;
    try {
      await Api.del('/employees/' + editingEmployee.id);
      await Promise.all([State.loadAll(), loadEmployees()]);
      closeDrawer();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  function render() {
    if (!Auth.isAtLeast('admin')) return; // защита от прямого показа при протухшей сессии — сам роут уже не пускает сюда не-admin
    renderKpis();
    renderFilterSeg();
    renderTable();
  }

  var initialized = false;
  function init() {
    document.getElementById('page-personnel').innerHTML = HTML;
    document.getElementById('pn-add-btn').addEventListener('click', openForCreate);
    document.getElementById('pn-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('pn-search').addEventListener('input', function () { searchValue = this.value; renderTable(); });
    document.getElementById('pn-form').addEventListener('submit', handleSubmit);
    document.getElementById('pn-delete-btn').addEventListener('click', handleDelete);
    document.getElementById('pn-f-driver').addEventListener('click', function () {
      this.classList.toggle('on');
      this.setAttribute('aria-pressed', this.classList.contains('on') ? 'true' : 'false');
      applyDriverFieldVisibility();
    });
    NumericInput.attach(document.getElementById('pn-f-salary'));
    document.getElementById('pn-f-salary').addEventListener('input', updatePreview);
    LicenseInput.attach(document.getElementById('pn-f-license'));
    document.getElementById('pn-period-add-btn').addEventListener('click', handleAddPeriod);
    initialized = true;
  }

  function show() {
    if (!initialized) init();
    render(); // сразу — с тем, что уже есть (пусто при первом заходе, кэш при повторном), без мигания пустым экраном
    loadEmployees().then(render);
  }

  window.PersonnelScreen = { show: show };
})();
