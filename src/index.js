import { fetchers, getFetcher } from './fetchers.js';
import {
  clearProxies,
  clearFetcherStats,
  ensureFetchers,
  exportProxies,
  getAllByProtocol,
  getAllProxies,
  getFetcherStatus,
  getMetaValue,
  getProxyByProtocol,
  getProxyStatus,
  getRandomValidated,
  markFetcherRun,
  setMetaValue,
  setFetcherEnabled,
  upsertProxies,
} from './repository.js';
import { ensureSchema } from './schema.js';
import {
  clearSessionCookie,
  createSessionCookie,
  html,
  isAuthorized,
  isHtmlRequest,
  json,
  proxyUrl,
  redirect,
  text,
  unauthorized,
} from './utils.js';

async function runFetchCycle(env, options = {}) {
  await ensureFetchers(env.DB, fetchers);

  const { selectedName = null, scheduled = false } = options;

  const fetcherStatus = await getFetcherStatus(env.DB);
  const enabledNames = new Set(fetcherStatus.filter((item) => item.enabled).map((item) => item.name));
  let jobs = (selectedName ? fetchers.filter((item) => item.name === selectedName) : fetchers)
    .filter((item) => selectedName || enabledNames.has(item.name));

  if (scheduled && jobs.length > 0) {
    const batchSize = Math.max(1, Number.parseInt(env.CRON_FETCH_BATCH_SIZE || '3', 10) || 3);
    const cursorRaw = await getMetaValue(env.DB, 'fetcher_cursor', '0');
    const cursor = Number.parseInt(cursorRaw, 10) || 0;
    const start = cursor % jobs.length;
    const orderedJobs = jobs.slice(start).concat(jobs.slice(0, start));
    jobs = orderedJobs.slice(0, batchSize);
    const nextCursor = (start + jobs.length) % (enabledNames.size || jobs.length || 1);
    await setMetaValue(env.DB, 'fetcher_cursor', nextCursor);
  }

  const results = [];

  for (const job of jobs) {
    try {
      const proxies = await job.run();
      const inserted = await upsertProxies(env.DB, job.name, proxies, env.WORKER_VALIDATE_MODE || 'source');
      await markFetcherRun(env.DB, job.name, proxies.length, true, null);
      results.push({ name: job.name, success: true, fetched: proxies.length, inserted });
    } catch (error) {
      await markFetcherRun(env.DB, job.name, 0, false, String(error.message || error));
      results.push({ name: job.name, success: false, error: String(error.message || error) });
    }
  }

  return results;
}

function requireAuth(request, env) {
  return isAuthorized(request, env).then((authorized) => {
    if (authorized) {
      return null;
    }

    if (isHtmlRequest(request)) {
      const url = new URL(request.url);
      const next = encodeURIComponent(url.pathname || '/web');
      return redirect(`/login?next=${next}`);
    }

    return unauthorized();
  });
}

function isApiPath(path) {
  return path === '/proxies_status'
    || path === '/fetchers_status'
    || path === '/validator_status'
    || path === '/validator_control'
    || path === '/export_proxies'
    || path === '/clear_proxies'
    || path === '/clear_fetchers_status'
    || path === '/fetcher_enable'
    || path.startsWith('/admin/');
}

function renderLoginFallback(message = '') {
  const safeMessage = String(message || '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]));
  return html(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>登录</title></head><body><pre>${safeMessage}</pre></body></html>`);
}

async function handleLogin(request, env) {
  if (request.method === 'GET') {
    if (await isAuthorized(request, env)) {
      const url = new URL(request.url);
      const next = url.searchParams.get('next') || '/web';
      return redirect(next);
    }

    const asset = await env.ASSETS.fetch(new Request(new URL('/login.html', request.url)));
    return asset.status === 404 ? renderLoginFallback('login page missing') : asset;
  }

  if (request.method !== 'POST') {
    return json({ success: false, error: 'method not allowed' }, 405);
  }

  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '');
  const password = String(body.password || '');
  const next = String(body.next || '/web');

  if (username !== env.ADMIN_USERNAME || password !== env.ADMIN_PASSWORD) {
    return json({ success: false, error: '用户名或密码错误' }, 401);
  }

  const cookie = await createSessionCookie(env, username);
  return json({ success: true, next }, 200, { 'set-cookie': cookie });
}

function handleLogout(env) {
  return redirect('/login', 302, { 'set-cookie': clearSessionCookie(env) });
}

async function checkAuth(request, env, path) {
  const authFailure = await requireAuth(request, env);
  if (authFailure) {
    return authFailure;
  }
  return null;
}

function isAdminPath(path) {
  return path === '/'
    || path === '/web'
    || path === '/fetchers'
    || path === '/proxies_status'
    || path === '/fetchers_status'
    || path === '/validator_status'
    || path === '/validator_control'
    || path === '/export_proxies'
    || path === '/clear_proxies'
    || path === '/clear_fetchers_status'
    || path === '/fetcher_enable'
    || path.startsWith('/admin/');
}

async function handleApi(request, env, path) {
  if (path === '/favicon.ico') {
    return new Response(null, { status: 204 });
  }

  if (path === '/login') {
    return handleLogin(request, env);
  }

  if (path === '/') {
    if (await isAuthorized(request, env)) {
      return redirect('/web');
    }
    return redirect('/login');
  }

  if (path === '/web') {
    const authFailure = await checkAuth(request, env, path);
    if (authFailure) return authFailure;
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
  }

  if (path === '/fetchers') {
    const authFailure = await checkAuth(request, env, path);
    if (authFailure) return authFailure;
    return env.ASSETS.fetch(new Request(new URL('/fetchers.html', request.url)));
  }

  if (path === '/logout') {
    return handleLogout(env);
  }

  if (isApiPath(path)) {
    const authFailure = await checkAuth(request, env, path);
    if (authFailure) return authFailure;
  }

  if (path === '/ping') {
    return text('API OK');
  }

  if (path === '/fetch_random') {
    const proxies = await getRandomValidated(env.DB, 1);
    return text(proxies[0] ? proxyUrl(proxies[0]) : '');
  }

  if (path === '/fetch_all') {
    const proxies = await getRandomValidated(env.DB, -1);
    return text(proxies.map(proxyUrl).join(','));
  }

  if (path === '/all') {
    const proxies = await getAllProxies(env.DB, -1);
    return json({ success: true, count: proxies.length, proxies: proxies.map(proxyUrl) });
  }

  const singleProtocolRoutes = {
    '/fetch_http': { protocol: 'http', validatedOnly: true, limit: 1, format: 'single' },
    '/fetch_https': { protocol: 'https', validatedOnly: true, limit: 1, format: 'single' },
    '/fetch_socks4': { protocol: 'socks4', validatedOnly: true, limit: 1, format: 'single' },
    '/fetch_socks5': { protocol: 'socks5', validatedOnly: true, limit: 1, format: 'single' },
    '/fetch_http_all': { protocol: 'http', validatedOnly: true, limit: -1, format: 'list' },
    '/fetch_https_all': { protocol: 'https', validatedOnly: true, limit: -1, format: 'list' },
    '/fetch_socks4_all': { protocol: 'socks4', validatedOnly: true, limit: -1, format: 'list' },
    '/fetch_socks5_all': { protocol: 'socks5', validatedOnly: true, limit: -1, format: 'list' },
    '/all_http': { protocol: 'http', validatedOnly: false, limit: -1, format: 'list' },
    '/all_https': { protocol: 'https', validatedOnly: false, limit: -1, format: 'list' },
    '/all_socks4': { protocol: 'socks4', validatedOnly: false, limit: -1, format: 'list' },
    '/all_socks5': { protocol: 'socks5', validatedOnly: false, limit: -1, format: 'list' },
  };

  if (singleProtocolRoutes[path]) {
    const route = singleProtocolRoutes[path];
    const proxies = route.validatedOnly
      ? await getProxyByProtocol(env.DB, route.protocol, route.limit, true)
      : await getAllByProtocol(env.DB, route.protocol);

    if (route.format === 'single') {
      return text(proxies[0] ? proxyUrl(proxies[0]) : '');
    }

    return text(proxies.map(proxyUrl).join(','));
  }

  const countedMatch = path.match(/^\/all\/(\d+)$/);
  if (countedMatch) {
    const count = Number.parseInt(countedMatch[1], 10);
    const proxies = await getAllProxies(env.DB, count);
    return json({ success: true, count: proxies.length, proxies: proxies.map(proxyUrl) });
  }

  if (path === '/proxies_status') {
    const proxies = await getRandomValidated(env.DB, -1);
    const status = await getProxyStatus(env.DB);
    return json({ success: true, proxies, ...status });
  }

  if (path === '/fetchers_status') {
    const fetcherStatus = await getFetcherStatus(env.DB);
    return json({ success: true, fetchers: fetcherStatus });
  }

  if (path === '/validator_status') {
    return json({ success: true, paused: true, supported: false, mode: env.WORKER_VALIDATE_MODE || 'source' });
  }

  if (path === '/validator_control' && request.method === 'POST') {
    return json({ success: true, paused: true, supported: false, message: 'worker mode does not support runtime validator control' });
  }

  if (path === '/export_proxies' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const exportType = body.type === 'all' ? 'all' : 'validated';
    const protocol = body.protocol || 'all';
    const proxies = await exportProxies(env.DB, protocol, exportType !== 'all');
    return text(proxies.map(proxyUrl).join('\n'));
  }

  if (path === '/admin/fetch' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const fetcherName = body.name || null;
    if (fetcherName && !getFetcher(fetcherName)) {
      return json({ success: false, error: 'unknown fetcher' }, 404);
    }

    const results = await runFetchCycle(env, { selectedName: fetcherName, scheduled: false });
    return json({ success: true, results });
  }

  if (path === '/admin/clear' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const protocol = body.protocol || 'all';
    const deleted = await clearProxies(env.DB, protocol);
    return json({ success: true, deleted_count: deleted });
  }

  if (path === '/clear_proxies' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const protocol = body.protocol || 'all';
    const deleted = await clearProxies(env.DB, protocol);
    return json({ success: true, deleted_count: deleted });
  }

  if (path === '/clear_fetchers_status') {
    await clearFetcherStats(env.DB);
    return json({ success: true });
  }

  if (path === '/fetcher_enable') {
    const url = new URL(request.url);
    const name = url.searchParams.get('name');
    const enable = url.searchParams.get('enable') === '1';
    if (!name || !getFetcher(name)) {
      return json({ success: false, error: 'unknown fetcher' }, 404);
    }

    await setFetcherEnabled(env.DB, name, enable);
    return json({ success: true });
  }

  return json({ success: false, error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      await ensureSchema(env.DB);
      await ensureFetchers(env.DB, fetchers);
      const url = new URL(request.url);
      return await handleApi(request, env, url.pathname);
    } catch (error) {
      return json({ success: false, error: String(error.message || error) }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureSchema(env.DB);
      await runFetchCycle(env, { scheduled: true });
    })());
  },
};
