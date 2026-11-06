import { boot, resetPreview } from './backend.js';

function banner() {
  const el = document.createElement('div');
  el.className = 'preview-pill';
  el.innerHTML = '<span>Preview — sample data, saved in this browser</span>';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Reset';
  b.addEventListener('click', () => {
    if (b.dataset.armed) return resetPreview();
    b.dataset.armed = '1';
    b.textContent = 'Click again to reset';
    setTimeout(() => { delete b.dataset.armed; b.textContent = 'Reset'; }, 3000);
  });
  el.appendChild(b);
  document.body.appendChild(el);
}

boot()
  .then(() => import('../main.jsx'))
  .then(banner)
  .catch((e) => {
    console.error(e);
    document.getElementById('root').innerHTML = `<div class="boot">Voltline could not start: ${String(e.message || e)}</div>`;
  });
