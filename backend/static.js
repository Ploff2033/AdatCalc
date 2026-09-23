const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', 'frontend');
const ROOT_V2 = path.join(__dirname, '..', 'frontend-v2');
const ROOT_SHARED = path.join(__dirname, '..', 'frontend', 'js', 'shared');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Сжимаем только текстовые форматы — картинки/иконки и так компактны,
// повторное сжатие только тратит CPU без пользы.
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg']);

// v2 — отдельный фронтенд на том же бэкенде (см. план v2/redesign):
// /v2/shared/* отдаёт общий с v1 код расчётов (frontend/js/shared/*), сам
// /v2/* — новый интерфейс (frontend-v2/*) со своим SPA-fallback на
// frontend-v2/index.html. Всё остальное — v1 (frontend/*) без изменений.
function resolveRoot(pathname) {
  if (pathname.startsWith('/v2/shared/')) {
    return { root: ROOT_SHARED, relPath: pathname.slice('/v2/shared'.length) || '/' };
  }
  if (pathname === '/v2' || pathname.startsWith('/v2/')) {
    return { root: ROOT_V2, relPath: pathname.slice('/v2'.length) || '/' };
  }
  return { root: ROOT, relPath: pathname };
}

async function serveStatic(req, res, pathname, isFallback) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Method Not Allowed');
    return;
  }

  const { root, relPath: rawRelPath } = resolveRoot(pathname);
  const relPath = rawRelPath === '/' ? '/index.html' : rawRelPath;
  const resolved = path.normalize(path.join(root, relPath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden');
    return;
  }

  try {
    const stat = await fsp.stat(resolved);
    if (stat.isDirectory()) {
      await serveStatic(req, res, path.posix.join(pathname, 'index.html'));
      return;
    }

    // Cache-Control: no-cache — браузер обязан спросить сервер перед тем как
    // использовать закэшированную копию, но если файл не менялся (по
    // Last-Modified), сервер отвечает пустым 304 вместо повторной прокачки
    // всего файла. Безопаснее max-age (нет риска подсунуть старую версию
    // после деплоя), но экономит и трафик, и время на неизменных файлах.
    const mtimeRounded = Math.floor(stat.mtimeMs / 1000) * 1000;
    const lastModified = new Date(mtimeRounded).toUTCString();
    const ifModifiedSince = req.headers['if-modified-since'];
    if (ifModifiedSince) {
      const sinceTime = new Date(ifModifiedSince).getTime();
      if (!isNaN(sinceTime) && sinceTime >= mtimeRounded) {
        res.writeHead(304, { 'Cache-Control': 'no-cache', 'Last-Modified': lastModified });
        res.end();
        return;
      }
    }

    const ext = path.extname(resolved);
    const type = CONTENT_TYPES[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      'Last-Modified': lastModified
    };

    const acceptEncoding = req.headers['accept-encoding'] || '';
    const useGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(acceptEncoding);
    if (useGzip) headers['Content-Encoding'] = 'gzip';

    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(resolved);
    if (useGzip) stream.pipe(zlib.createGzip()).pipe(res);
    else stream.pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // isFallback защищает от бесконечной рекурсии, если у фронтенда ещё
      // нет своего index.html (например frontend-v2/ до Фазы 1) — тогда
      // это настоящий 404, а не deep-link, который стоит подменить.
      if (path.extname(pathname) || isFallback) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      } else {
        // SPA deep-link fallback (e.g. a bookmarked #hash route) -> index.html
        // своего фронтенда (v1 или v2 — смотря в чей путь попали).
        const fallback = pathname.startsWith('/v2') ? '/v2' : '/index.html';
        await serveStatic(req, res, fallback, true);
      }
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal server error');
    }
  }
}

module.exports = { serveStatic };
