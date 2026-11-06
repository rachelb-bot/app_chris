// Minimal Express-style router for running the API in the browser preview.
export function Router() {
  const stack = [];
  const router = (req, res, next) => dispatch(stack, req, res).then((handled) => { if (!handled) next(); }, next);
  for (const m of ['get', 'post', 'put', 'delete']) router[m] = (path, ...h) => { stack.push({ method: m.toUpperCase(), path, h }); return router; };
  router.use = (...h) => { if (typeof h[0] === 'string') h.shift(); stack.push({ h }); return router; };
  return router;
}

function match(pattern, path) {
  const a = pattern.split('/'), b = path.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** Runs one handler. Resolves true if it called next(), false if it finished the response. */
export function call(fn, req, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (f, v) => { if (!settled) { settled = true; f(v); } };
    const next = (err) => (err ? settle(reject, err) : settle(resolve, true));
    try {
      Promise.resolve(fn(req, res, next)).then(() => { if (res.sent || fn.length < 3) settle(resolve, false); }, (e) => settle(reject, e));
    } catch (e) { settle(reject, e); }
  });
}

export async function dispatch(stack, req, res) {
  for (const layer of stack) {
    if (layer.method) {
      if (layer.method !== req.method) continue;
      const params = match(layer.path, req.path);
      if (!params) continue;
      req.params = params;
    }
    for (const fn of layer.h) {
      if (!(await call(fn, req, res))) return true;
    }
  }
  return false;
}
export default { Router };
