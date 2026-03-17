/* ================================================================
   MUNDO CHARRO — main.js
   Odoo JSON-RPC integration + UI utilities
   ================================================================ */

// ── CONFIGURACIÓN ODOO ──────────────────────────────────────────
const ODOO_CONFIG = {
  // CAMBIA ESTO a tu URL de Odoo (ej: https://miempresa.odoo.com)
  baseUrl: 'https://TU-DOMINIO.odoo.com',
  db: 'TU-DATABASE-NAME',      // nombre de tu base de datos en Odoo
  username: 'tu-email@odoo.com', // usuario API
  password: 'TU-API-KEY',        // API Key de Odoo (Settings > Technical > API Keys)
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
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params
      })
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

  // Crear Lead en CRM
  async createLead(data) {
    return await this.createRecord('crm.lead', {
      name: data.name,
      contact_name: data.contactName,
      email_from: data.email,
      phone: data.phone,
      description: data.description,
      tag_ids: data.tagIds || [],
      team_id: data.teamId || false,
      type: 'lead',
    });
  }

  // Crear Oportunidad (para reservas confirmadas)
  async createOpportunity(data) {
    return await this.createRecord('crm.lead', {
      name: data.name,
      contact_name: data.contactName,
      email_from: data.email,
      phone: data.phone,
      description: data.description,
      expected_revenue: data.revenue || 0,
      type: 'opportunity',
    });
  }

  // Crear Orden de Venta (para boletos)
  async createSaleOrder(data) {
    // Buscar o crear cliente
    const partnerId = await this.findOrCreatePartner(data);
    const orderId = await this.createRecord('sale.order', {
      partner_id: partnerId,
      note: data.notes || '',
      order_line: data.lines.map(l => [0, 0, {
        product_id: l.productId,
        name: l.name,
        product_uom_qty: l.qty,
        price_unit: l.price,
      }])
    });
    return orderId;
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

// ── RESERVA HOTEL → CRM LEAD ────────────────────────────────────
window.submitHotelReserva = async function(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]');
  await submitForm(btn, async () => {
    const checkin  = f.checkin?.value  || '';
    const checkout = f.checkout?.value || '';
    const hab      = f.habitacion?.value || '';
    const huespedes = f.huespedes?.value || '1';
    const nombre   = f.nombre?.value || '';
    const email    = f.email?.value  || '';
    const telefono = f.telefono?.value || '';
    const notas    = f.notas?.value || '';

    const leadId = await odoo.createOpportunity({
      name: `Reserva Hotel — ${nombre} | Check-in: ${checkin}`,
      contactName: nombre,
      email,
      phone: telefono,
      description: `Check-in: ${checkin}\nCheck-out: ${checkout}\nHabitación: ${hab}\nHuéspedes: ${huespedes}\nNotas: ${notas}`,
      revenue: 0,
    });
    showToast('¡Reserva recibida!', `Tu solicitud fue enviada. ID de referencia: #${leadId}. Te contactaremos pronto.`);
    f.reset();
  });
};

// ── RESERVA CONVENCIONES → CRM LEAD ────────────────────────────
window.submitConvencionReserva = async function(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]');
  await submitForm(btn, async () => {
    const empresa  = f.empresa?.value  || '';
    const contacto = f.contacto?.value || '';
    const email    = f.email?.value    || '';
    const telefono = f.telefono?.value || '';
    const fecha    = f.fecha?.value    || '';
    const espacio  = f.espacio?.value  || '';
    const asistentes = f.asistentes?.value || '';
    const tipoEvento = f.tipo_evento?.value || '';
    const desc     = f.descripcion?.value || '';

    const leadId = await odoo.createLead({
      name: `Evento Convenciones — ${empresa} | ${tipoEvento} | ${fecha}`,
      contactName: contacto,
      email,
      phone: telefono,
      description: `Empresa: ${empresa}\nFecha: ${fecha}\nEspacio: ${espacio}\nAsistentes: ${asistentes}\nTipo de evento: ${tipoEvento}\nDescripción: ${desc}`,
    });
    showToast('¡Solicitud enviada!', `Propuesta recibida. ID: #${leadId}. Un ejecutivo te contactará en 24 hrs.`);
    f.reset();
  });
};

// ── CONTACTO GENERAL → CRM LEAD ────────────────────────────────
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
    });
    showToast('¡Mensaje enviado!', `Gracias por contactarnos. ID: #${leadId}. Te respondemos pronto.`);
    f.reset();
  });
};

// ── COMPRA BOLETOS FIFA → SALE ORDER + LEAD ─────────────────────
window.submitBoletoFIFA = async function(e) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]');
  await submitForm(btn, async () => {
    const nombre   = f.nombre?.value   || '';
    const email    = f.email?.value    || '';
    const telefono = f.telefono?.value || '';
    const categoria = f.categoria?.value || 'General';
    const cantidad = parseInt(f.cantidad?.value || '1');
    const precios  = { 'VIP': 8500, 'Preferente': 5500, 'General': 2800 };
    const precio   = precios[categoria] || 2800;

    // Crear Lead en CRM
    const leadId = await odoo.createLead({
      name: `Boleto FIFA — ${categoria} × ${cantidad} — ${nombre}`,
      contactName: nombre,
      email,
      phone: telefono,
      description: `Evento: Copa Mundial FIFA — Inauguración\nCategoría: ${categoria}\nCantidad: ${cantidad}\nTotal: $${(precio * cantidad).toLocaleString()} MXN`,
    });

    showToast(
      '¡Pre-registro completado!',
      `${cantidad} boleto(s) ${categoria} registrado(s). ID: #${leadId}. Recibirás instrucciones de pago en tu correo.`
    );
    f.reset();
    // Mostrar sección de pago
    const paySection = document.getElementById('pago-section');
    if (paySection) {
      paySection.style.display = 'block';
      paySection.scrollIntoView({ behavior: 'smooth' });
    }
  });
};

// ── NAVBAR ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Hamburger
  const ham = document.getElementById('hamburger');
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

  // Scroll reveal
  const revealEls = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
  }, { threshold: 0.1 });
  revealEls.forEach(el => observer.observe(el));

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.tab-group');
      const target = btn.dataset.tab;
      group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      group.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      group.querySelector(`#tab-${target}`)?.classList.add('active');
    });
  });

  // Active nav link
  const path = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(a => {
    if (a.getAttribute('href') && path.includes(a.getAttribute('href').replace('.html',''))) {
      a.classList.add('active');
    }
  });
});

// ── ANIMATE NUMBERS ──────────────────────────────────────────────
function animateNumber(el, target, duration = 1500) {
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const val = Math.floor(progress * target);
    el.textContent = val.toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = target.toLocaleString();
  };
  requestAnimationFrame(update);
}

// Observe stat numbers
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
