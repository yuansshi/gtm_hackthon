let csrf = '';
let pendingSession;
export async function connect(accessToken) {
  const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(accessToken ? { accessToken } : {}) }) });
  const data = await response.json();
  if (!response.ok) { const e = new Error(data.error); e.code = data.code; throw e; }
  csrf = data.csrf; return data;
}
export async function api(path, method = 'GET', body) {
  if (!csrf) { pendingSession ||= connect().finally(() => { pendingSession = null; }); await pendingSession; }
  const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401) csrf = ''; const error = new Error(data.error || 'Request failed'); error.code = data.code; throw error; }
  return data;
}
export const profileOf = s => Object.fromEntries(['company', 'productFamilies', 'capabilities', 'commercial', 'icp', 'expansionDecisions','expansionAdjustments'].map(k => [k, s[k]]));
