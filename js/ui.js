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

// Urutan tabel yang dipilih, diingat per halaman dan susunan kolom selama aplikasi terbuka.
const urutanTabel = new Map();

// Nilai pembanding dari isi sel: tanggal dd/mm/yyyy, angka format Indonesia (1.250.000,5 / Rp), atau teks.
function nilaiUrut(teks) {
  const t = teks.trim();
  if (!t || t === '-') return null;
  const tg = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (tg) return Number(tg[3] + tg[2] + tg[1]);
  // Angka di awal sel, boleh diikuti satuan ("1.200 sak") atau diawali "Rp"
  const m = t.match(/^(?:Rp\s*)?([-−]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?)\s*%?(?:\s+\S.*)?$/i);
  if (m) return Number(m[1].replace('−', '-').replace(/\./g, '').replace(',', '.'));
  return t;
}

function bandingkan(a, b) {
  if (a === null || b === null) return a === b ? 0 : (a === null ? 1 : -1); // kosong selalu di bawah
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'id', { numeric: true, sensitivity: 'base' });
}

// Tabel daftar. Klik judul kolom untuk mengurutkan (naik, turun, lalu kembali ke urutan awal).
// Kolom tanpa label atau kol-aksi tidak bisa diurutkan. urut: false mematikan pengurutan.
export function tabel(kolom, baris, kosong = 'Belum ada data.', { urut = true } = {}) {
  if (!baris.length) return h('p', { class: 'kosong' }, kosong);
  const bisaUrut = (k) => urut && baris.length > 1 && k.label && k.kelas !== 'kol-aksi';
  const kunci = `${location.hash}|${kolom.map((k) => k.label).join('|')}`;
  const barisTr = baris.map((r) =>
    h('tr', {}, kolom.map((k) => h('td', { class: k.kelas, 'data-label': k.label }, k.isi(r)))));
  const tbody = h('tbody', {}, barisTr);
  const ths = kolom.map((k, i) => h('th', {
    class: [k.kelas, bisaUrut(k) && 'bisa-urut'].filter(Boolean).join(' ') || null,
    ...(bisaUrut(k) ? { tabindex: 0, title: 'Klik untuk mengurutkan', onclick: () => klik(i),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); klik(i); } } } : {}),
  }, k.label));
  const pilihUrut = baris.length > 1 && urut && h('select', {
    class: 'pilih-urut', 'aria-label': 'Urutkan',
    onchange: (e) => { const [i, arah] = e.target.value.split(':'); terapkan(i === '' ? null : { i: Number(i), arah }); },
  }, h('option', { value: ':' }, 'Urutkan: urutan awal'),
  kolom.flatMap((k, i) => (bisaUrut(k) ? [
    h('option', { value: `${i}:naik` }, `${k.label} (A-Z / kecil-besar)`),
    h('option', { value: `${i}:turun` }, `${k.label} (Z-A / besar-kecil)`)] : [])));

  function terapkan(u) {
    if (u) urutanTabel.set(kunci, u); else urutanTabel.delete(kunci);
    let urutan = barisTr;
    if (u && barisTr[0]?.children[u.i]) {
      const nilai = new Map(barisTr.map((tr) => [tr, nilaiUrut(tr.children[u.i].textContent)]));
      urutan = [...barisTr].sort((a, b) => {
        const va = nilai.get(a), vb = nilai.get(b);
        if (va === null || vb === null) return bandingkan(va, vb);
        return u.arah === 'naik' ? bandingkan(va, vb) : bandingkan(vb, va);
      });
    }
    tbody.replaceChildren(...urutan);
    ths.forEach((th, i) => {
      if (!th.classList.contains('bisa-urut')) return;
      const aktif = u && u.i === i;
      th.classList.toggle('urut-naik', !!aktif && u.arah === 'naik');
      th.classList.toggle('urut-turun', !!aktif && u.arah === 'turun');
      th.setAttribute('aria-sort', aktif ? (u.arah === 'naik' ? 'ascending' : 'descending') : 'none');
    });
    if (pilihUrut) pilihUrut.value = u ? `${u.i}:${u.arah}` : ':';
  }
  function klik(i) {
    const u = urutanTabel.get(kunci);
    if (!u || u.i !== i) terapkan({ i, arah: 'naik' });
    else if (u.arah === 'naik') terapkan({ i, arah: 'turun' });
    else terapkan(null);
  }

  const tabelWrap = h('div', { class: 'tabel-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ths)), tbody));
  if (!pilihUrut) return tabelWrap;
  const wadah = h('div', { class: 'tabel-urut' }, pilihUrut, tabelWrap);
  const tersimpan = urutanTabel.get(kunci);
  if (tersimpan && bisaUrut(kolom[tersimpan.i] ?? {})) terapkan(tersimpan); else terapkan(null);
  return wadah;
}

// tutupLuar: klik di area gelap di luar kotak menutup modal. Form memakai false supaya isian
// tidak hilang. Menarik scrollbar area gelap tidak pernah dianggap klik di luar.
export function modal(judul, isi, { lebar = false, tutupLuar = true } = {}) {
  const tutup = () => latar.remove();
  let tekanDiLuar = false;
  const diLuar = (e) => e.target === latar && e.clientX < latar.clientWidth && e.clientY < latar.clientHeight;
  const latar = h('div', {
    class: 'modal-latar',
    onmousedown: (e) => { tekanDiLuar = diLuar(e); },
    onclick: (e) => { if (tutupLuar && tekanDiLuar && diLuar(e)) tutup(); tekanDiLuar = false; },
  },
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

  tutup = modal(judul, form, { tutupLuar: false });
  form.querySelector('input:not([readonly]),select,textarea')?.focus();
}

export function konfirmasi(pesanTeks) {
  return window.confirm(pesanTeks);
}
