/* ================================================================
   MUNDO CHARRO — main.js
   Odoo JSON-RPC integration + UI utilities
   ================================================================ */

// ── CLOUDFLARE WORKER (Hotel) ───────────────────────────────────
const WORKER_URL = "https://plain-violet-1e1a.pavanafrancisco.workers.dev";

// ── CONFIGURACIÓN ODOO (otros formularios) ──────────────────────
const ODOO_CONFIG = {
  baseUrl: 'https://mundocharro.odoo.com',
  db: 'mundocharro',
  username: 'francisco.pavana@mundocharro.mx',
  password: 'cbd7980aef0e5a56d5b9f26abc18c5a53ad54109',
};

// Tags IDs en Odoo CRM
const TAGS = {
  hotel:        21,
  convenciones: 22,
  fifa:         23,
  contacto:     24,
};

// ── ODOO JSON-RPC CLIENT ────────────────────────────────────────
class OdooAPI {
  constructor(config) {
    this.config = config;
    this.uid = null;
  }

  async call(path, params) {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.data?.message || data.error.message);
    return data.result;
  }

  async authenticate() {
    if (this.uid) return this.uid;
    this.uid = await this.call('/web/dataset/call_kw', {
      model: 'res.users',
      method: 'authenticate',
      args: [this.config.db, this.config.username, this.config.password, {}],
      kwargs: {}
    });
    return this.uid;
  }

  async createRecord(model, values) {
    await this.authenticate();
    return await this.call('/web/dataset/call_kw', {
      model,
      method: 'create',
      args: [values],
      kwargs: { context: { lang: 'es_MX' } }
    });
  }

  async createLead(data) {
    return await this.createRecord('crm.lead', {
      name: data.name,
      contact_name: data.contactName,
      email_from: data.email,
      phone: data.phone,
      description: data.description,
      tag_ids: data.tagIds ? data.tagIds.map(id => [4, id]) : [],
      team_id: data.teamId || false,
      type: 'lead',
    });
  }

  async createOpportunity(data) {
    return await this.createRecord('crm.lead', {
      name: data.name,
      contact_name: data.contactName,
      email_from: data.email,
      phone: data.phone,
      description: data.description,
      expected_revenue: data.revenue || 0,
      tag_ids: data.tagIds ? data.tagIds.map(id => [4, id]) : [],
      type: 'opportunity',
    });
  }

  async createSaleOrder(data) {
    const partnerId = await this.findOrCreatePartner(data);
    return await this.createRecord('sale.order', {
      partner_id: partnerId,
      note: data.notes || '',
      order_line: data.lines.map(l => [0, 0, {
        product_id: l.productId,
        name: l.name,
        product_uom_qty: l.qty,
        price_unit: l.price,
      }])
    });
  }

  async findOrCreatePartner(data) {
    await this.authenticate();
    const existing = await this.call('/web/dataset/call_kw', {
      model: 'res.partner',
      method: 'search_read',
      args: [[['email', '=', data.email]]],
      kwargs: { fields: ['id', 'name'], limit: 1 }
    });
    if (existing.length) return existing[0].id;
    return await this.createRecord('res.partner', {
      name: data.contactName,
      email: data.email,
      phone: data.phone,
      lang: 'es_MX',
    });
  }
}

const odoo = new OdooAPI(ODOO_CONFIG);

// ── TOAST NOTIFICATIONS ─────────────────────────────────────────
function showToast(title, msg, type = 'success') {
  let t = document.getElementById('toast-global');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast-global';
    t.className = 'toast';
    t.innerHTML = `<div class="toast-title"></div><div class="toast-msg"></div>`;
    document.body.appendChild(t);
  }
  t.querySelector('.toast-title').textContent = title;
  t.querySelector('.toast-msg').textContent = msg;
  t.style.borderColor = type === 'error' ? '#C23030' : '#C9973A';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 5000);
}

// ── FORM SUBMIT HELPER ──────────────────────────────────────────
async function submitForm(btn, action) {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Enviando...`;
  try {
    await action();
    btn.innerHTML = `✓ Enviado`;
    btn.style.background = '#2A5C2A';
  } catch (err) {
    console.error(err);
    btn.innerHTML = original;
    btn.disabled = false;
    showToast('Error', 'Por favor intente de nuevo o contáctenos directamente.', 'error');
  }
}

// ── RESERVA HOTEL → CLOUDFLARE WORKER → ODOO (tag: Hotel) ──────
window.submitHotelReserva = async function(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]');
  await submitForm(btn, async () => {
    const payload = {
      nombre:     f.nombre?.value || '',
      email:      f.email?.value || '',
      telefono:   f.telefono?.value || '',
      checkin:    f.checkin?.value || '',
      checkout:   f.checkout?.value || '',
      habitacion: f.habitacion?.value || '',
      huespedes:  f.huespedes?.value || '',
      notas:      f.notas?.value || '',
    };
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    showToast('¡Reserva recibida!', `Tu solicitud fue enviada. ID: #${data.leadId}. Te contactaremos pronto.`);
    f.reset();
  });
};

// ── RESERVA CONVENCIONES → CRM LEAD (tag: Convenciones) ────────
window.submitConvencionReserva = async function(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]');
  await submitForm(btn, async () => {
    const leadId = await odoo.createLead({
      name: `Evento Convenciones — ${f.empresa?.value} | ${f.tipo_evento?.value} | ${f.fecha?.value}`,
      contactName: f.contacto?.value || '',
      email: f.email?.value || '',
      phone: f.telefono?.value || '',
      description:
        `Empresa: ${f.empresa?.value || ''}\n` +
        `Fecha: ${f.fecha?.value || ''}\n` +
        `Espacio: ${f.espacio?.value || ''}\n` +
        `Asistentes: ${f.asistentes?.value || ''}\n` +
        `Tipo de evento: ${f.tipo_evento?.value || ''}\n` +
        `Descripción: ${f.descripcion?.value || ''}`,
      tagIds: [TAGS.convenciones],
    });
    showToast('¡Solicitud enviada!', `Propuesta recibida. ID: #${leadId}. Un ejecutivo te contactará en 24 hrs.`);
    f.reset();
  });
};

// ── CONTACTO GENERAL → CRM LEAD (tag: Contacto) ────────────────
window.submitContacto = async function(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]');
  await submitForm(btn, async () => {
    const leadId = await odoo.createLead({
      name: `Contacto Web — ${f.nombre?.value}`,
      contactName: f.nombre?.value || '',
      email: f.email?.value || '',
      phone: f.telefono?.value || '',
      description: `Asunto: ${f.asunto?.value || ''}\nMensaje: ${f.mensaje?.value || ''}`,
      tagIds: [TAGS.contacto],
    });
    showToast('¡Mensaje enviado!', `Gracias por contactarnos. ID: #${leadId}. Te respondemos pronto.`);
    f.reset();
  });
};

// ── COMPRA BOLETOS FIFA → CRM LEAD (tag: FIFA) ─────────────────
window.submitBoletoFIFA = async function(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]');
  await submitForm(btn, async () => {
    const nombre    = f.nombre?.value    || '';
    const email     = f.email?.value     || '';
    const telefono  = f.telefono?.value  || '';
    const categoria = f.categoria?.value || 'General';
    const cantidad  = parseInt(f.cantidad?.value || '1');
    const precios   = { 'VIP': 8500, 'Preferente': 5500, 'General': 2800 };
    const precio    = precios[categoria] || 2800;

    const leadId = await odoo.createLead({
      name: `Boleto FIFA — ${categoria} × ${cantidad} — ${nombre}`,
      contactName: nombre,
      email,
      phone: telefono,
      description:
        `Evento: Copa Mundial FIFA — Inauguración\n` +
        `Categoría: ${categoria}\n` +
        `Cantidad: ${cantidad}\n` +
        `Total: $${(precio * cantidad).toLocaleString()} MXN`,
      tagIds: [TAGS.fifa],
    });
    showToast(
      '¡Pre-registro completado!',
      `${cantidad} boleto(s) ${categoria} registrado(s). ID: #${leadId}. Recibirás instrucciones de pago en tu correo.`
    );
    f.reset();
    const paySection = document.getElementById('pago-section');
    if (paySection) {
      paySection.style.display = 'block';
      paySection.scrollIntoView({ behavior: 'smooth' });
    }
  });
};

// ── NAVBAR ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const ham  = document.getElementById('hamburger');
  const menu = document.getElementById('nav-menu');
  ham?.addEventListener('click', () => {
    menu.classList.toggle('open');
    ham.querySelectorAll('span').forEach((s, i) => {
      if (menu.classList.contains('open')) {
        if (i === 0) s.style.transform = 'rotate(45deg) translate(5px, 5px)';
        if (i === 1) s.style.opacity = '0';
        if (i === 2) s.style.transform = 'rotate(-45deg) translate(5px, -5px)';
      } else {
        s.style.transform = ''; s.style.opacity = '';
      }
    });
  });

  const revealEls = document.querySelectorAll('.reveal');
  const observer  = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  revealEls.forEach(el => observer.observe(el));

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group  = btn.closest('.tab-group');
      const target = btn.dataset.tab;
      group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      group.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      group.querySelector(`#tab-${target}`)?.classList.add('active');
    });
  });

  const path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(a => {
    if (a.getAttribute('href') && path.includes(a.getAttribute('href').replace('.html', ''))) {
      a.classList.add('active');
    }
  });
});

// ── ANIMATE NUMBERS ─────────────────────────────────────────────
function animateNumber(el, target, duration = 1500) {
  const start  = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent  = Math.floor(progress * target).toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = target.toLocaleString();
  };
  requestAnimationFrame(update);
}

document.addEventListener('DOMContentLoaded', () => {
  const statNums = document.querySelectorAll('[data-count]');
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        animateNumber(e.target, parseInt(e.target.dataset.count));
        obs.unobserve(e.target);
      }
    });
  });
  statNums.forEach(el => obs.observe(el));
});
