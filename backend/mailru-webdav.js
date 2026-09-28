// Минимальный WebDAV-клиент для Облака Mail.ru — у него нет публичного API
// для записи в отдельные ячейки "живой" таблицы (в отличие от Google
// Таблиц), единственный официальный способ положить туда файл программно —
// WebDAV (см. https://help.mail.ru/cloud/desktop/webdav/): логин от
// аккаунта Mail.ru + отдельный "пароль для внешних приложений" (обычный
// пароль от почты с 2022 года для этого не подходит).
const WEBDAV_BASE = 'https://webdav.cloud.mail.ru';

function authHeader(login, appPassword) {
  return 'Basic ' + Buffer.from(login + ':' + appPassword, 'utf8').toString('base64');
}

function encodePath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

// MKCOL создаёт ровно один уровень папки — для вложенных путей глубже
// одного каталога понадобилось бы звать по уровню за раз, но текущему
// использованию (backend/mailru-sync.js кладёт всё в один каталог "/ДДС")
// хватает и этого.
async function ensureFolder(login, appPassword, folderPath) {
  const res = await fetch(WEBDAV_BASE + '/' + encodePath(folderPath), {
    method: 'MKCOL',
    headers: { Authorization: authHeader(login, appPassword) }
  });
  // 201 — создано; 405/409 — папка уже существует (разные серверы отвечают
  // по-разному на повторный MKCOL) — оба варианта нормальны.
  if (!res.ok && res.status !== 405 && res.status !== 409) {
    throw new Error('Не удалось создать папку в Облаке Mail.ru (HTTP ' + res.status + ')');
  }
}

async function uploadFile(login, appPassword, filePath, buffer) {
  const res = await fetch(WEBDAV_BASE + '/' + encodePath(filePath), {
    method: 'PUT',
    headers: {
      Authorization: authHeader(login, appPassword),
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    },
    body: buffer
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('Mail.ru отклонил логин/пароль (401) — проверьте пароль для внешних приложений');
    const text = await res.text().catch(() => '');
    throw new Error('Не удалось загрузить файл в Облако Mail.ru (HTTP ' + res.status + ')' + (text ? ': ' + text.slice(0, 200) : ''));
  }
}

module.exports = { ensureFolder, uploadFile };
