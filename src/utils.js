export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function text(data, status = 200, headers = {}) {
  return new Response(data, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    },
  });
}

export function unauthorized() {
  return json({ success: false, error: 'unauthorized' }, 401, {
    'www-authenticate': 'Basic realm="ProxyPool"',
  });
}

export function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = atob(header.slice(6));
    const index = decoded.indexOf(':');
    if (index === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, index),
      password: decoded.slice(index + 1),
    };
  } catch {
    return null;
  }
}

export function isAuthorized(request, env) {
  const auth = parseBasicAuth(request.headers.get('authorization'));
  if (!auth) {
    return false;
  }

  return auth.username === env.ADMIN_USERNAME && auth.password === env.ADMIN_PASSWORD;
}

export function nowIso() {
  return new Date().toISOString();
}

export function proxyUrl(proxy) {
  return `${proxy.protocol}://${proxy.ip}:${proxy.port}`;
}

export function normalizeProxy(source, protocol, ip, port) {
  const cleanedProtocol = String(protocol || '').trim().toLowerCase();
  const cleanedIp = String(ip || '').trim();
  const cleanedPort = Number.parseInt(String(port || '').trim(), 10);

  if (!['http', 'https', 'socks4', 'socks5'].includes(cleanedProtocol)) {
    return null;
  }

  if (!cleanedIp || !Number.isInteger(cleanedPort) || cleanedPort < 1 || cleanedPort > 65535) {
    return null;
  }

  return {
    source,
    protocol: cleanedProtocol,
    ip: cleanedIp,
    port: cleanedPort,
  };
}

export function uniqueProxies(proxies) {
  const seen = new Set();
  const results = [];

  for (const proxy of proxies) {
    if (!proxy) {
      continue;
    }

    const key = `${proxy.protocol}:${proxy.ip}:${proxy.port}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(proxy);
  }

  return results;
}

export function sampleItems(items, count) {
  if (count < 0 || count >= items.length) {
    return items;
  }

  return items.slice(0, count);
}
