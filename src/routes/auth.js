import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import db from '../db.js';
import { sendVerificationEmail } from '../mail.js';
import { permet } from '../lib/rateLimit.js';
import { NIVELLS } from '../brand.js';

const r = Router();

function nivellValid(id) {
  return NIVELLS.some(n => n.id === id) ? id : '';
}

function netejaTelefon(v) {
  const t = String(v || '').trim().slice(0, 20);
  return /^[+0-9][0-9 .\-()]*$/.test(t) ? t : '';
}

function sessio(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, email_verified: !!user.email_verified };
}

// Registre de jugador
r.get('/registre', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('registre', { titol: "Registre't", error: null, NIVELLS, next: req.query.next || '' });
});

r.post('/registre', (req, res) => {
  const { nom = '', email = '', contrasenya = '', nivell = '', telefon = '', next = '' } = req.body;
  const em = email.trim().toLowerCase();
  if (!nom.trim() || !em || contrasenya.length < 6) {
    return res.render('registre', { titol: "Registre't", error: 'Omple tots els camps (la contrasenya, mínim 6 caràcters).', NIVELLS, next });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(em)) {
    return res.render('registre', { titol: "Registre't", error: 'Aquest email ja està registrat. Entra amb la teva contrasenya.', NIVELLS, next });
  }
  if (!permet('registre:' + req.ip, 5, 24 * 3600 * 1000)) {
    return res.render('registre', { titol: "Registre't", error: 'Massa registres des d\u2019aquesta connexió. Torna-ho a provar demà.', NIVELLS, next });
  }
  const hash = bcrypt.hashSync(contrasenya, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash, name, level, phone) VALUES (?, ?, ?, ?, ?)')
    .run(em, hash, nom.trim(), nivellValid(nivell), netejaTelefon(telefon));
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO email_tokens (user_id, token) VALUES (?, ?)').run(info.lastInsertRowid, token);
  sendVerificationEmail(em, nom.trim(), token);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  req.session.user = sessio(user);
  const desti = next.startsWith('/') ? next : '/elmeucompte?benvingut=1';
  res.redirect(desti);
});

// Entrada
r.get('/entra', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('entra', { titol: 'Entra', error: null, next: req.query.next || '' });
});

r.post('/entra', (req, res) => {
  const em = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(em);
  if (!user || !bcrypt.compareSync(String(req.body.contrasenya || ''), user.password_hash)) {
    return res.render('entra', { titol: 'Entra', error: 'Email o contrasenya incorrectes.', next: req.body.next || '' });
  }
  req.session.user = sessio(user);
  const next = req.body.next || '/';
  res.redirect(next.startsWith('/') ? next : '/');
});

r.post('/surt', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Verificació d'email
r.get('/verifica/:token', (req, res) => {
  const tok = db.prepare('SELECT * FROM email_tokens WHERE token = ?').get(req.params.token);
  if (!tok) return res.render('entra', { titol: 'Entra', error: 'Enllaç de verificació no vàlid.', next: '' });
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(tok.user_id);
  db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(tok.user_id);
  if (req.session.user && req.session.user.id === tok.user_id) req.session.user.email_verified = 1;
  res.redirect('/elmeucompte?verificat=1');
});

// Reenviar verificació (limitat: 1 cada 10 min per no saturar l'enviament)
r.post('/reenvia-verificacio', (req, res) => {
  if (!req.session.user) return res.redirect('/entra');
  if (!permet('reenvia:' + req.session.user.id, 1, 10 * 60 * 1000)) {
    return res.redirect('/elmeucompte?reenvit=1'); // com si s'hagués enviat
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(req.session.user.id);
  db.prepare('INSERT INTO email_tokens (user_id, token) VALUES (?, ?)').run(req.session.user.id, token);
  sendVerificationEmail(req.session.user.email, req.session.user.name, token);
  res.redirect('/elmeucompte?reenvit=1');
});

// Canviar l'email (només mentre el compte encara no està verificat)
r.get('/canvia-email', (req, res) => {
  if (!req.session.user) return res.redirect('/entra');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!u || u.email_verified) return res.redirect('/elmeucompte');
  res.render('canvia-email', { titol: 'Corregeix l\u2019email', error: null, email: u.email });
});

r.post('/canvia-email', (req, res) => {
  if (!req.session.user) return res.redirect('/entra');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!u || u.email_verified) return res.redirect('/elmeucompte');
  const nou = String(req.body.email || '').trim().toLowerCase();
  const torna = (error) => res.render('canvia-email', { titol: 'Corregeix l\u2019email', error, email: nou || u.email });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nou)) return torna('Escriu un email vàlid.');
  if (nou === u.email) return torna('És el mateix email que ja tens.');
  if (db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(nou, u.id)) {
    return torna('Aquest email ja està registrat amb un altre compte.');
  }
  if (!permet('canvia-email:' + u.id, 3, 3600 * 1000)) {
    return torna('Has fet massa canvis. Espera una estona i torna-ho a provar.');
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(nou, u.id);
  db.prepare('DELETE FROM email_tokens WHERE user_id = ?').run(u.id);
  db.prepare('INSERT INTO email_tokens (user_id, token) VALUES (?, ?)').run(u.id, token);
  sendVerificationEmail(nou, u.name, token);
  req.session.user.email = nou;
  res.redirect('/elmeucompte?avisa=email-canviat');
});

export default r;
