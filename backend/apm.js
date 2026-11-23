// Client for the APM (API Proxy Manager) service: mails and SMS.
// Config (env): APM_API_URL (e.g. http://host:8001), APM_API_KEY (X-API-KEY of an APM external app
// allowed to use mail_send / sms_send).

const baseUrl = () => (process.env.APM_API_URL || '').trim().replace(/\/+$/, '');
const apiKey = () => (process.env.APM_API_KEY || '').trim();

const isConfigured = () => Boolean(baseUrl() && apiKey());

async function call(path, body) {
  if (!isConfigured()) {
    const e = new Error('APM is not configured (APM_API_URL / APM_API_KEY)');
    e.status = 503;
    throw e;
  }
  const res = await fetch(`${baseUrl()}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = new Error((data && (data.error || data.message)) || `APM error ${res.status}`);
    e.status = res.status >= 500 ? 502 : res.status;
    throw e;
  }
  return data;
}

// to: address or array of addresses. content: HTML. opts: { cc, bcc, is_raw, from_name, from_email }
const sendMail = (to, subject, content, opts = {}) =>
  call('/mail/send', { to, subject, content, ...opts });

// mobile: international or national number. opts: { title, tpoa }
const sendSms = (mobile, message, opts = {}) =>
  call('/sms/send', { mobile, message, ...opts });

module.exports = { isConfigured, sendMail, sendSms };
