// Client for the APM (API Proxy Manager) service: mails and SMS.
// Config (env):
//   APM_API_URL       e.g. https://api.ivry.local/ or http://host:8001
//   APM_API_KEY       X-API-KEY of an APM external app allowed to use mail_send / sms_send
//   APM_INSECURE_TLS  "1" to accept a self-signed / untrusted certificate for APM calls ONLY
//                     (scoped to this client, never process-wide). Prefer NODE_EXTRA_CA_CERTS.
const http = require('http');
const https = require('https');

const baseUrl = () => (process.env.APM_API_URL || '').trim().replace(/\/+$/, '');
const apiKey = () => (process.env.APM_API_KEY || '').trim();
const insecureTls = () => ['1', 'true', 'yes'].includes(String(process.env.APM_INSECURE_TLS || '').toLowerCase());

const isConfigured = () => Boolean(baseUrl() && apiKey());

function request(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-API-KEY': apiKey() },
      timeout: 20000,
      ...(u.protocol === 'https:' && insecureTls() ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { raw += d; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch { /* empty or non-JSON body */ }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('APM request timed out')));
    req.on('error', (e) => reject(new Error(`APM unreachable: ${(e.code ? e.code + ' ' : '') + e.message}`)));
    req.end(payload);
  });
}

async function call(path, body) {
  if (!isConfigured()) {
    const e = new Error('APM is not configured (APM_API_URL / APM_API_KEY)');
    e.status = 503;
    throw e;
  }
  let res;
  try { res = await request(`${baseUrl()}/api/v1${path}`, body); }
  catch (e) { e.status = 502; throw e; }
  if (res.status < 200 || res.status >= 300) {
    const e = new Error((res.data && (res.data.error || res.data.message)) || `APM error ${res.status}`);
    e.status = res.status >= 500 ? 502 : res.status;
    throw e;
  }
  return res.data;
}

// to: address or array of addresses. content: HTML. opts: { cc, bcc, is_raw, from_name, from_email }
const sendMail = (to, subject, content, opts = {}) =>
  call('/mail/send', { to, subject, content, ...opts });

// mobile: international or national number. opts: { title, tpoa }
const sendSms = (mobile, message, opts = {}) =>
  call('/sms/send', { mobile, message, ...opts });

module.exports = { isConfigured, sendMail, sendSms };
