const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT = path.join(__dirname, '..', 'frontend');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

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
    const ext = path.extname(resolved);
    const type = CONTENT_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    if (req.method === 'HEAD') {
      res.end();
    } else {
      fs.createReadStream(resolved).pipe(res);
    }
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
