'use strict';
const api = window.siftUtility;
const $ = selector => document.querySelector(selector);
const activeStatuses = new Set(['queued', 'running', 'cancelling']);
const jobNodes = new Map();
let snapshot = {}, pendingStartup = false, lastAnnouncement = '';
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function errorMessage(error) {
  $('#error').textContent = String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  $('#error').hidden = false;
}
async function action(request) {
  $('#error').hidden = true;
  try { await api.action(request); render(await api.snapshot()); }
  catch (error) { errorMessage(error); }
}
function view(value) {
  const settings = (typeof value === 'string' ? value : value?.view) === 'settings';
  $('#settings-view').hidden = !settings;
  $('#jobs-view').hidden = settings;
  for (const [id, selected] of [['settings-tab', settings], ['jobs-tab', !settings]]) {
    if (selected) $(`#${id}`).setAttribute('aria-current', 'page');
    else $(`#${id}`).removeAttribute('aria-current');
  }
}
function label(operation) {
  const names = { background:'Add background', crop:'Crop image', edit:'Edit image', redact:'Redact image', annotate:'Annotate image', metadata:'Remove metadata', compress:'Compress image', jpeg:'JPG' };
  return names[operation] || String(operation || 'Conversion').toUpperCase();
}
function createJob(id) {
  const root = node('article', 'card job'); root.dataset.id = id;
  const header = node('div', 'job-header'), title = node('span', 'job-title'), badge = node('span', 'badge');
  header.append(title, badge);
  const detail = node('p', 'job-detail'), progress = node('progress'); progress.max = 1;
  progress.setAttribute('aria-label', 'Files processed');
  const error = node('p', 'job-error'), results = node('div', 'job-results'), actions = node('div', 'job-actions');
  const cancel = node('button', 'text-button', 'Cancel');
  cancel.addEventListener('click', () => action({ action:'cancel-job', id })); actions.append(cancel);
  root.append(header, detail, progress, error, results, actions);
  return {root, title, badge, detail, progress, error, results, actions, cancel, resultKey:''};
}
function renderJob(job) {
  let parts = jobNodes.get(job.id);
  if (!parts) { parts = createJob(job.id); jobNodes.set(job.id, parts); }
  const active = activeStatuses.has(job.status), progress = job.progress || {};
  const statusText = {running:'Working', queued:'Queued', cancelling:'Cancelling…', completed:'Saved', complete:'Saved', 'completed-with-errors':'Partly saved', failed:'Failed', partial:'Partly saved', cancelled:'Cancelled'}[job.status] || job.status;
  parts.title.textContent = label(job.operation);
  parts.badge.textContent = statusText;
  parts.badge.className = `badge ${job.status}`;
  const good = (job.results || []).filter(item => !item.error).length;
  const mediaTime = Number.isFinite(progress.seconds) ? ` · ${Math.floor(progress.seconds / 60)}:${String(Math.floor(progress.seconds % 60)).padStart(2, '0')} encoded` : '';
  parts.detail.textContent = active
    ? job.status === 'cancelling' ? 'Finishing safely and cleaning up temporary files…'
      : progress.total ? `${Math.min(progress.index || 0, progress.total)} of ${progress.total} files processed${progress.pages ? ` · page ${progress.page || 0} of ${progress.pages}` : mediaTime}` : 'Preparing your files…'
    : `${good} ${good === 1 ? 'file' : 'files'} saved${job.completedAt ? ' · ' + new Date(job.completedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}`;
  parts.progress.hidden = !active;
  if (progress.total && progress.index > 0) parts.progress.value = Math.min(1, progress.index / progress.total);
  else parts.progress.removeAttribute('value');
  parts.error.textContent = job.error || ''; parts.error.hidden = !job.error;
  parts.actions.hidden = !active; parts.cancel.disabled = job.status === 'cancelling';
  parts.cancel.textContent = job.status === 'cancelling' ? 'Cancelling…' : 'Cancel';
  const resultKey = JSON.stringify(job.results || []);
  if (parts.resultKey !== resultKey) {
    parts.resultKey = resultKey; parts.results.replaceChildren();
    for (const result of job.results || []) {
      const row = node('div', `result${result.error ? ' result-error' : ''}`);
      row.append(node('span', '', result.error ? `${result.name || 'File'}: ${result.error}` : result.name || 'Saved file'));
      if (!result.error && result.path) {
        const show = node('button', 'text-button', 'Show');
        show.addEventListener('click', () => action({action:'show-result', path:result.path})); row.append(show);
      }
      parts.results.append(row);
    }
  }
  return parts.root;
}
function render(value) {
  if (!value) return;
  snapshot = value;
  const state = value.state || {}, startup = value.startup || {}, jobs = value.jobs || [];
  const busy = jobs.some(job => activeStatuses.has(job.status));
  $('#app-status').textContent = busy ? 'Working in the background' : 'Ready in the background';
  $('#convert').disabled = busy;
  $('#startup').checked = Boolean(startup.enabled || startup.status === 'requires-approval');
  $('#startup').disabled = !startup.supported || pendingStartup;
  $('#startup-status').textContent = startup.message || (startup.enabled ? 'On · confirmed by your system' : 'Off · start Sift when you need it');
  $('#gesture').checked = state.gestureEnabled !== false;
  $('#gesture-hint').textContent = `Hold Shift for formats · ${value.platform === 'darwin' ? 'Command' : 'Alt'} for image tools.`;
  $('#mac-permission').hidden = value.platform !== 'darwin' || value.gestureAvailable === true;
  $('#output-path').textContent = state.outputDir || 'Beside the originals';
  $('#reset-output').hidden = !state.outputDir;
  $('#version').textContent = `Sift ${value.version || ''} · Offline file utility`;
  $('#empty').hidden = jobs.length > 0;
  const keep = new Set(jobs.map(job => job.id));
  for (const [id, parts] of jobNodes) if (!keep.has(id)) { parts.root.remove(); jobNodes.delete(id); }
  jobs.forEach((job, index) => {
    const element = renderJob(job), container = $('#jobs');
    if (container.children[index] !== element) container.insertBefore(element, container.children[index] || null);
  });
  const announcement = jobs[0] ? `${label(jobs[0].operation)}: ${jobs[0].status}` : '';
  if (lastAnnouncement !== announcement) { lastAnnouncement = announcement; $('#job-announcement').textContent = announcement; }
}
$('#jobs-tab').addEventListener('click', () => view('jobs'));
$('#settings-tab').addEventListener('click', () => view('settings'));
for (const [id, name] of [['convert','convert-files'], ['choose-output','choose-output'], ['reset-output','reset-output'], ['open-output','open-output'], ['logs','open-logs'], ['hide','hide'], ['gesture-access','gesture-access']]) {
  $(`#${id}`).addEventListener('click', () => action({action:name}));
}
$('#gesture').addEventListener('change', () => action({action:'set-gesture', enabled:$('#gesture').checked}));
$('#startup').addEventListener('change', async () => {
  const enabled = $('#startup').checked; pendingStartup = true; $('#startup').disabled = true;
  await action({action:'set-startup', enabled}); pendingStartup = false;
  try { render(await api.snapshot()); } catch (error) { errorMessage(error); }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') action({action:'hide'}); });
api.onSnapshot(render); api.onView(view);
api.snapshot().then(render).catch(errorMessage);
