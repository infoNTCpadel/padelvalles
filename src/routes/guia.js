// Landing del lead magnet per a jugadors: «10 errors que et fan perdre partits».
// El formulari demana nom + email (+ consentiment) i:
//   - desa el lead a guia_leads (per comptar d'on venen: font=ig-dm, ig-bio, web...)
//   - l'afegeix a la llista de Brevo (la mateixa del butlletí)
// Després mostra la pàgina de gràcies amb l'enllaç de descàrrega del PDF
// (public/guia-jugadors.pdf).

import express from 'express';
import db from '../db.js';
import { afegirALlistaBrevo } from '../mail.js';

const r = express.Router();

const TITOL = 'Guia gratuïta: 10 errors que et fan perdre partits';
const DESCRIPCIO = 'Descarrega gratis la guia de PadelVallès: 10 errors que et fan perdre partits i com corregir-los, amb consells d’entrenador.';
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

r.get('/guia', (req, res) => {
  res.render('guia', {
    titol: TITOL,
    metaDescription: DESCRIPCIO,
    font: String(req.query.font || 'web').slice(0, 40),
    error: null,
    nom: '',
    email: '',
  });
});

r.post('/guia', async (req, res) => {
  const nom = String(req.body.nom || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  const font = String(req.body.font || 'web').slice(0, 40);
  const consent = req.body.consent === '1';
  const renderError = (error) => res.render('guia', {
    titol: TITOL, metaDescription: DESCRIPCIO, font, error, nom, email,
  });
  // Honeypot anti-bots: el camp 'web' és invisible; si ve ple, és un bot.
  // Li mostrem la gràcies igual (sense desar res) perquè no detecti el filtre.
  if (req.body.web) return res.render('guia-gracies', { titol: 'La guia és teva!' });
  if (!nom) return renderError('Escriu el teu nom.');
  if (!EMAIL_OK.test(email)) return renderError('Escriu un email vàlid.');
  if (!consent) return renderError('Cal acceptar la política de privacitat per rebre la guia.');
  try {
    db.prepare('INSERT OR IGNORE INTO guia_leads (email, nom, font) VALUES (?, ?, ?)').run(email, nom, font);
  } catch (e) {
    console.error('[guia] error desant el lead:', e.message);
  }
  await afegirALlistaBrevo(email, nom);
  res.render('guia-gracies', { titol: 'La guia és teva!' });
});

export default r;
