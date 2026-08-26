const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', 'frontend');

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

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Method Not Allowed');
    return;
  }

  const relPath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.normalize(path.join(ROOT, relPath));
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
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
      if (path.extname(pathname)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      } else {
        // SPA deep-link fallback (e.g. a bookmarked #hash route) -> index.html
        await serveStatic(req, res, '/index.html');
      }
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Internal server error');
    }
  }
}

module.exports = { serveStatic };
