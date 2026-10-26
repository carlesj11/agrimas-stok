// Bantuan kecil untuk membangun tampilan tanpa framework.

export function h(tag, attrs = {}, ...anak) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const a of anak.flat()) {
    if (a == null || a === false) continue;
    el.append(a instanceof Node ? a : document.createTextNode(String(a)));
  }
  return el;
}

const fmtAngka = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const fmtUang = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const angka = (n) => fmtAngka.format(Number(n ?? 0));
export const rupiah = (n) => 'Rp ' + fmtUang.format(Number(n ?? 0));

let timerToast;
export function toast(pesan, jenis = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = pesan;
  el.className = `toast toast-${jenis}`;
  el.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => { el.hidden = true; }, jenis === 'error' ? 6000 : 3000);
}

export function lencana(aktif) {
  return h('span', { class: aktif ? 'lencana lencana-aktif' : 'lencana lencana-nonaktif' },
    aktif ? 'Aktif' : 'Nonaktif');
}

export function tabel(kolom, baris, kosong = 'Belum ada data.') {
  if (!baris.length) return h('p', { class: 'kosong' }, kosong);
  return h('div', { class: 'tabel-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, kolom.map((k) => h('th', { class: k.kelas }, k.label)))),
      h('tbody', {}, baris.map((r) =>
        h('tr', {}, kolom.map((k) => h('td', { class: k.kelas, 'data-label': k.label }, k.isi(r))))))));
}

export function modal(judul, isi, { lebar = false } = {}) {
  const tutup = () => latar.remove();
  const latar = h('div', { class: 'modal-latar', onmousedown: (e) => { if (e.target === latar) tutup(); } },
    h('div', { class: lebar ? 'modal modal-lebar' : 'modal', role: 'dialog', 'aria-label': judul },
      h('div', { class: 'modal-kepala' },
        h('h2', {}, judul),
        h('button', { class: 'tombol-ikon', type: 'button', 'aria-label': 'Tutup', onclick: tutup }, '×')),
      isi));
  document.body.append(latar);
  const onKey = (e) => { if (e.key === 'Escape') { tutup(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  return tutup;
}

// field: [{ key, label, type, required, options, hint, step, placeholder, hanyaBaca }]
export function bukaForm({ judul, field, nilai = {}, onSimpan, labelSimpan = 'Simpan' }) {
  const input = {};
  const pesan = h('p', { class: 'form-error', hidden: true });
  const tombol = h('button', { class: 'tombol tombol-utama', type: 'submit' }, labelSimpan);

  const baris = field.map((f) => {
    const id = `f-${f.key}`;
    const v = nilai[f.key] ?? f.bawaan ?? '';
    let el;
    if (f.type === 'select') {
      el = h('select', { id, required: f.required, disabled: f.hanyaBaca },
        !f.required && h('option', { value: '' }, '-'),
        f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(v) }, o.label)));
    } else if (f.type === 'textarea') {
      el = h('textarea', { id, rows: 2, value: v });
    } else if (f.type === 'checkbox') {
      el = h('input', { id, type: 'checkbox', checked: nilai[f.key] ?? f.bawaan ?? true });
      input[f.key] = el;
      return h('label', { class: 'form-centang' }, el, f.label);
    } else {
      el = h('input', {
        id, type: f.type ?? 'text', value: v, required: f.required, step: f.step ?? (f.type === 'number' ? 'any' : null),
        min: f.type === 'number' ? (f.min ?? 0) : null, placeholder: f.placeholder, readonly: f.hanyaBaca,
        autocomplete: f.type === 'password' ? 'new-password' : 'off',
      });
    }
    input[f.key] = el;
    return h('div', { class: f.lebar ? 'form-baris form-penuh' : 'form-baris' },
      h('label', { for: id }, f.label, f.required && h('span', { class: 'wajib' }, ' *')),
      el,
      f.hint && h('small', {}, f.hint));
  });

  let tutup;
  const form = h('form', {
    class: 'form',
    onsubmit: async (e) => {
      e.preventDefault();
      const data = {};
      for (const f of field) {
        if (f.hanyaBaca) continue;
        const el = input[f.key];
        if (f.type === 'checkbox') data[f.key] = el.checked;
        else if (f.type === 'number') data[f.key] = el.value === '' ? 0 : Number(el.value);
        else data[f.key] = el.value.trim() === '' ? null : el.value.trim();
      }
      tombol.disabled = true;
      pesan.hidden = true;
      try {
        await onSimpan(data);
        tutup();
      } catch (err) {
        pesan.textContent = err.message;
        pesan.hidden = false;
      } finally {
        tombol.disabled = false;
      }
    },
  },
  h('div', { class: 'form-grid' }, baris),
  pesan,
  h('div', { class: 'form-aksi' },
    h('button', { class: 'tombol', type: 'button', onclick: () => tutup() }, 'Batal'),
    tombol));

  tutup = modal(judul, form);
  form.querySelector('input:not([readonly]),select,textarea')?.focus();
}

export function konfirmasi(pesanTeks) {
  return window.confirm(pesanTeks);
}
