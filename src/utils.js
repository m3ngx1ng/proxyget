export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function html(data, status = 200, headers = {}) {
  return new Response(data, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
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
  return json({ success: false, error: 'unauthorized' }, 401);
}

export function redirect(location, status = 302, headers = {}) {
  return new Response(null, {
    status,
    headers: {
      location,
      ...headers,
    },
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

export function parseCookies(header) {
  const cookies = {};
  for (const item of String(header || '').split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (!key) {
      continue;
    }
    cookies[key] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

async function importSessionKey(secret) {
  const keyData = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function encodeBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function createSessionCookie(env, username) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({ username, exp: expiresAt });
  const key = await importSessionKey(env.SESSION_SECRET || env.ADMIN_PASSWORD);
  const payloadBytes = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign('HMAC', key, payloadBytes);
  const token = `${encodeBase64Url(payloadBytes)}.${encodeBase64Url(signature)}`;
  return `pp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${env.COOKIE_SECURE === '0' ? '' : '; Secure'}`;
}

export function clearSessionCookie(env) {
  return `pp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${env.COOKIE_SECURE === '0' ? '' : '; Secure'}`;
}

export async function getSession(request, env) {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies.pp_session;
  if (!token || !token.includes('.')) {
    return null;
  }

  const [payloadPart, signaturePart] = token.split('.', 2);
  try {
    const payloadBytes = decodeBase64Url(payloadPart);
    const signatureBytes = decodeBase64Url(signaturePart);
    const key = await importSessionKey(env.SESSION_SECRET || env.ADMIN_PASSWORD);
    const verified = await crypto.subtle.verify('HMAC', key, signatureBytes, payloadBytes);
    if (!verified) {
      return null;
    }

    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!payload?.username || !payload?.exp || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function isAuthorized(request, env) {
  const session = await getSession(request, env);
  return Boolean(session?.username);
}

export function isHtmlRequest(request) {
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
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
