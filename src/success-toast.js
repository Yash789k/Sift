'use strict';
let token;
const api = window.siftCompletion, button = document.querySelector('#success-show');
api.onPresent(payload => {
  token = payload.token;
  document.querySelector('#success-text').textContent = payload.count > 1 ? `${payload.count} files saved` : 'File saved';
  document.querySelector('#success-detail').textContent = payload.warning || payload.name;
  document.querySelector('#success-detail').title = payload.warning || payload.name;
  document.body.className = 'ready';
  button.disabled = false;
  // Populate and paint while hidden, then start the native visible interval.
  requestAnimationFrame(() => requestAnimationFrame(() => api.ready(payload.token).catch(() => {})));
});
api.onFade(value => { if (value === token) document.body.classList.add('fading'); });
button.addEventListener('click', () => { button.disabled = true; void api.show(token).catch(() => {}); });
