import { normalizeProxy, uniqueProxies } from './utils.js';

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

function stripTags(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRows(html) {
  return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (match) => match[1]);
}

function extractCells(rowHtml) {
  return Array.from(rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi), (match) => stripTags(match[1]));
}

function parseIpPortTable(html, source, protocol = 'http', options = {}) {
  const rows = extractRows(html);
  const proxies = [];
  const cellIndex = options.cellIndex || [0, 1];

  for (const row of rows) {
    const cells = extractCells(row);
    if (cells.length <= Math.max(...cellIndex)) {
      continue;
    }

    const ip = cells[cellIndex[0]];
    const port = cells[cellIndex[1]];
    const proxy = normalizeProxy(source, protocol, ip, port);
    if (proxy) {
      proxies.push(proxy);
    }
  }

  return proxies;
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${url}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      accept: 'application/json,text/plain,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${url}`);
  }

  return response.json();
}

function parseHostPortLines(source, protocol, text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(':');
      if (parts.length !== 2) {
        return null;
      }
      return normalizeProxy(source, protocol, parts[0], parts[1]);
    })
    .filter(Boolean);
}

async function fetchMany(urls, parser, limit = urls.length) {
  const proxies = [];
  for (const url of urls.slice(0, limit)) {
    try {
      const body = await fetchText(url);
      proxies.push(...parser(body, url));
    } catch {
      continue;
    }
  }
  return proxies;
}

function sampleRange(start, count, max) {
  const values = [];
  for (let index = start; index < start + count; index += 1) {
    if (index > max) {
      break;
    }
    values.push(index);
  }
  return values;
}

async function runUUProxy() {
  const data = await fetchJson('https://uu-proxy.com/api/free');
  const items = data?.free?.proxies || [];
  return uniqueProxies(items.map((item) => normalizeProxy('uu-proxy.com', item.scheme, item.ip, item.port)));
}

async function runKuaidaili() {
  const urls = [];
  for (const type of ['inha', 'intr', 'fps']) {
    for (const page of sampleRange(1, 4, 10)) {
      urls.push(`https://www.kuaidaili.com/free/${type}/${page}/`);
    }
  }
  const proxies = await fetchMany(urls, (html) => parseIpPortTable(html, 'www.kuaidaili.com'));
  return uniqueProxies(proxies);
}

function decodeGoubanjiaPort(classKey) {
  const alphabet = 'ABCDEFGHIZ';
  const digits = String(classKey || '').split('').map((char) => alphabet.indexOf(char)).join('');
  if (!digits) {
    return null;
  }
  return String(Number.parseInt(digits, 10) >> 3);
}

async function runGoubanjia() {
  const html = await fetchText('http://www.goubanjia.com/');
  const rows = extractRows(html);
  const proxies = [];

  for (const row of rows) {
    const ipCellMatch = row.match(/<td[^>]*class=["']ip["'][^>]*>([\s\S]*?)<\/td>/i);
    if (!ipCellMatch) {
      continue;
    }

    let ipHtml = ipCellMatch[1]
      .replace(/<p[^>]*style=["'][^"']*display\s*:\s*none;?[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
      .replace(/<span[^>]*class=["']port[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '');
    const portClassMatch = ipCellMatch[1].match(/<span[^>]*class=["'][^"']*port\s+([^\s"']+)/i);

    ipHtml = stripTags(ipHtml);
    const [ip] = ipHtml.split(':');
    const port = decodeGoubanjiaPort(portClassMatch?.[1]);
    const proxy = normalizeProxy('www.goubanjia.com', 'http', ip, port);
    if (proxy) {
      proxies.push(proxy);
    }
  }

  return uniqueProxies(proxies);
}

async function run66ip() {
  const urls = [];
  for (const areaIndex of [0, 1, 2]) {
    for (const page of sampleRange(1, 3, 5)) {
      urls.push(areaIndex === 0 ? `http://www.66ip.cn/${page}.html` : `http://www.66ip.cn/areaindex_${areaIndex}/${page}.html`);
    }
  }
  const proxies = await fetchMany(urls, (html) => parseIpPortTable(html, 'www.66ip.cn'));
  return uniqueProxies(proxies);
}

async function runIp3366() {
  const urls = [];
  for (const type of ['1', '2']) {
    for (const page of sampleRange(1, 3, 5)) {
      urls.push(`http://www.ip3366.net/free/?stype=${type}&page=${page}`);
    }
  }
  const proxies = await fetchMany(urls, (html) => parseIpPortTable(html, 'www.ip3366.net'));
  return uniqueProxies(proxies);
}

async function runJiangxianli() {
  const urls = sampleRange(1, 4, 4).map((page) => `https://ip.jiangxianli.com/?page=${page}`);
  const proxies = await fetchMany(urls, (html) => parseIpPortTable(html, 'ip.jiangxianli.com'));
  return uniqueProxies(proxies);
}

async function runIHuan() {
  const ihuanHeaders = {
    referer: 'https://ip.ihuan.me/',
    origin: 'https://ip.ihuan.me',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'upgrade-insecure-requests': '1',
  };

  let entryHtml;
  try {
    entryHtml = await fetchText('https://ip.ihuan.me/', ihuanHeaders);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('403')) {
      throw new Error('ip.ihuan.me returned 403, likely blocking Cloudflare Worker egress');
    }
    throw error;
  }

  const paginationMatches = Array.from(entryHtml.matchAll(/href=["'](\?page=\d+)["']/gi), (match) => match[1]);
  const urls = ['https://ip.ihuan.me/'];
  for (const href of paginationMatches.slice(0, 3)) {
    urls.push(`https://ip.ihuan.me/${href}`);
  }
  const bodies = [entryHtml];
  for (const url of urls.slice(1)) {
    try {
      bodies.push(await fetchText(url, ihuanHeaders));
    } catch {
      continue;
    }
  }
  const proxies = bodies.flatMap((html) => parseIpPortTable(html, 'ip.ihuan.me'));
  return uniqueProxies(proxies);
}

async function run89ip() {
  const urls = sampleRange(1, 4, 9).map((page) => `https://www.89ip.cn/index_${page}.html`);
  const proxies = await fetchMany(urls, (html) => parseIpPortTable(html, 'www.89ip.cn'));
  return uniqueProxies(proxies);
}

async function runProxyscan() {
  const proxies = [];
  for (let index = 0; index < 4; index += 1) {
    const data = await fetchJson(`https://www.proxyscan.io/api/proxy?last_check=9800&uptime=50&limit=20&_t=${Date.now()}_${index}`);
    proxies.push(...data.flatMap((item) => {
      const protocols = Array.isArray(item.type) ? item.type : Array.isArray(item.Type) ? item.Type : [];
      return protocols.map((protocol) => normalizeProxy('www.proxyscan.io', String(protocol).toLowerCase(), item.ip || item.Ip, item.port || item.Port));
    }));
  }
  return uniqueProxies(proxies);
}

async function runKxdaili() {
  const urls = [];
  for (const type of ['1', '2']) {
    for (const page of sampleRange(1, 4, 10)) {
      urls.push(`http://www.kxdaili.com/dailiip/${type}/${page}.html`);
    }
  }
  const proxies = await fetchMany(urls, (html) => parseIpPortTable(html, 'www.kxdaili.com'));
  return uniqueProxies(proxies);
}

async function runXila() {
  const urls = [];
  for (const section of ['gaoni', 'http']) {
    for (const page of sampleRange(1, 4, 30)) {
      urls.push(`http://www.xiladaili.com/${section}/${page}/`);
    }
  }
  const proxies = await fetchMany(urls, (html) => {
    const rows = extractRows(html);
    return rows.map((row) => {
      const firstCell = extractCells(row)[0] || '';
      const [ip, port] = firstCell.split(':');
      return normalizeProxy('www.xiladaili.com', 'http', ip, port);
    }).filter(Boolean);
  });
  return uniqueProxies(proxies).slice(0, 200);
}

async function runXsdaili() {
  const entryHtml = await fetchText('http://www.xsdaili.cn/dayProxy/1.html');
  const detailUrls = Array.from(entryHtml.matchAll(/href=["']([^"']*\/dayProxy\/ip[^"']+)["']/gi), (match) => match[1])
    .map((href) => href.startsWith('http') ? href : `http://www.xsdaili.cn${href}`)
    .slice(0, 6);

  const proxies = [];
  for (const url of detailUrls) {
    try {
      const html = await fetchText(url);
      const blocks = Array.from(html.matchAll(/<div[^>]*class=["'][^"']*cont[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi), (match) => stripTags(match[1]));
      for (const block of blocks) {
        for (const line of block.split(/\r?\n/)) {
          const match = line.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/);
          if (!match) {
            continue;
          }
          const proxy = normalizeProxy('www.xsdaili.cn', 'http', match[1], match[2]);
          if (proxy) {
            proxies.push(proxy);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return uniqueProxies(proxies).slice(0, 200);
}

async function runProxyListDownload() {
  const mappings = [
    ['http', 'https://www.proxy-list.download/api/v1/get?type=http'],
    ['https', 'https://www.proxy-list.download/api/v1/get?type=https'],
    ['socks4', 'https://www.proxy-list.download/api/v1/get?type=socks4'],
    ['socks5', 'https://www.proxy-list.download/api/v1/get?type=socks5'],
  ];

  const proxies = [];
  for (const [protocol, url] of mappings) {
    const body = await fetchText(url);
    proxies.push(...parseHostPortLines('www.proxy-list.download', protocol, body));
  }

  return uniqueProxies(proxies);
}

async function runProxyScrape() {
  const protocols = ['http', 'https', 'socks4', 'socks5'];
  const proxies = [];

  for (const protocol of protocols) {
    const url = `https://api.proxyscrape.com/?request=displayproxies&proxytype=${protocol}`;
    const body = await fetchText(url);
    proxies.push(...parseHostPortLines('proxyscrape.com', protocol, body));
  }

  return uniqueProxies(proxies);
}

export const fetchers = [
  { name: 'uu-proxy.com', run: runUUProxy },
  { name: 'www.kuaidaili.com', run: runKuaidaili },
  { name: 'www.goubanjia.com', run: runGoubanjia },
  { name: 'www.66ip.cn', run: run66ip },
  { name: 'www.ip3366.net', run: runIp3366 },
  { name: 'ip.jiangxianli.com', run: runJiangxianli },
  { name: 'ip.ihuan.me', run: runIHuan },
  { name: 'www.proxyscan.io', run: runProxyscan },
  { name: 'www.89ip.cn', run: run89ip },
  { name: 'www.kxdaili.com', run: runKxdaili },
  { name: 'www.xiladaili.com', run: runXila },
  { name: 'www.xsdaili.cn', run: runXsdaili },
  { name: 'www.proxy-list.download', run: runProxyListDownload },
  { name: 'proxyscrape.com', run: runProxyScrape },
];

export function getFetcher(name) {
  return fetchers.find((fetcher) => fetcher.name === name) || null;
}
