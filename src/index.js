import { fetchers, getFetcher } from './fetchers.js';
import {
  clearProxies,
  clearFetcherStats,
  ensureFetchers,
  exportProxies,
  getAllByProtocol,
  getAllProxies,
  getFetcherStatus,
  getProxyByProtocol,
  getProxyStatus,
  getRandomValidated,
  markFetcherRun,
  setFetcherEnabled,
  upsertProxies,
} from './repository.js';
import { isAuthorized, json, proxyUrl, text, unauthorized } from './utils.js';

async function runFetchCycle(env, selectedName = null) {
  await ensureFetchers(env.DB, fetchers);

  const fetcherStatus = await getFetcherStatus(env.DB);
  const enabledNames = new Set(fetcherStatus.filter((item) => item.enabled).map((item) => item.name));
  const jobs = (selectedName ? fetchers.filter((item) => item.name === selectedName) : fetchers)
    .filter((item) => selectedName || enabledNames.has(item.name));
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
  if (!isAuthorized(request, env)) {
    return unauthorized();
  }
  return null;
}

async function handleApi(request, env, path) {
  if (path === '/') {
    const asset = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
    return asset.status === 404 ? json({ success: true, name: 'proxypool-worker' }) : asset;
  }

  if (path === '/web') {
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url)));
  }

  if (path === '/fetchers') {
    return env.ASSETS.fetch(new Request(new URL('/fetchers.html', request.url)));
  }

  if (path === '/logout') {
    return new Response('Logged out', {
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="ProxyPool"' },
    });
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
    const authFailure = requireAuth(request, env);
    if (authFailure) {
      return authFailure;
    }
    return json({ success: true, paused: true, supported: false, message: 'worker mode does not support runtime validator control' });
  }

  if (path === '/export_proxies' && request.method === 'POST') {
    const authFailure = requireAuth(request, env);
    if (authFailure) {
      return authFailure;
    }

    const body = await request.json().catch(() => ({}));
    const exportType = body.type === 'all' ? 'all' : 'validated';
    const protocol = body.protocol || 'all';
    const proxies = await exportProxies(env.DB, protocol, exportType !== 'all');
    return text(proxies.map(proxyUrl).join('\n'));
  }

  if (path === '/admin/fetch' && request.method === 'POST') {
    const authFailure = requireAuth(request, env);
    if (authFailure) {
      return authFailure;
    }

    const body = await request.json().catch(() => ({}));
    const fetcherName = body.name || null;
    if (fetcherName && !getFetcher(fetcherName)) {
      return json({ success: false, error: 'unknown fetcher' }, 404);
    }

    const results = await runFetchCycle(env, fetcherName);
    return json({ success: true, results });
  }

  if (path === '/admin/clear' && request.method === 'POST') {
    const authFailure = requireAuth(request, env);
    if (authFailure) {
      return authFailure;
    }

    const body = await request.json().catch(() => ({}));
    const protocol = body.protocol || 'all';
    const deleted = await clearProxies(env.DB, protocol);
    return json({ success: true, deleted_count: deleted });
  }

  if (path === '/clear_proxies' && request.method === 'POST') {
    const authFailure = requireAuth(request, env);
    if (authFailure) {
      return authFailure;
    }

    const body = await request.json().catch(() => ({}));
    const protocol = body.protocol || 'all';
    const deleted = await clearProxies(env.DB, protocol);
    return json({ success: true, deleted_count: deleted });
  }

  if (path === '/clear_fetchers_status') {
    const authFailure = requireAuth(request, env);
    if (authFailure) {
      return authFailure;
    }

    await clearFetcherStats(env.DB);
    return json({ success: true });
  }

  if (path === '/fetcher_enable') {
    const authFailure = requireAuth(request, env);
    if (authFailure) {
      return authFailure;
    }

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
    await ensureFetchers(env.DB, fetchers);
    const url = new URL(request.url);
    return handleApi(request, env, url.pathname);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runFetchCycle(env));
  },
};
