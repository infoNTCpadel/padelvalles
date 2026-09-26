import express from 'express';
import session from 'express-session';
import layouts from 'express-ejs-layouts';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import db from './db.js';
import { BRAND } from './brand.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));
app.use(layouts);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/fitxers', express.static(path.join(process.cwd(), 'data', 'uploads')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'padelvalles-canvia-aixo',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 3600 * 1000 }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.brand = BRAND;
  res.locals.appUrl = process.env.APP_URL || 'https://padelvalles.com';
  // Invitacions pendents: insígnia visible des de qualsevol pàgina
  let invitacionsPendents = 0;
  if (req.session.user) {
    try {
      invitacionsPendents = db.prepare(`SELECT COUNT(*) n FROM registrations
        WHERE player2_id = ? AND status = 'pending'`).get(req.session.user.id).n;
    } catch { /* si la taula encara no existeix, no bloqueja la web */ }
  }
  // Panell del club: gestors, admins i monitors autoritzats en algun club
  let tePanell = false;
  if (req.session.user) {
    const rol = req.session.user.role;
    tePanell = rol === 'club' || rol === 'admin';
    if (!tePanell && rol === 'monitor') {
      try {
        tePanell = !!db.prepare('SELECT 1 FROM club_monitors WHERE user_id = ? LIMIT 1').get(req.session.user.id);
      } catch { /* taula encara no creada */ }
    }
  }
  res.locals.tePanell = tePanell;
  next();
});

// Crea l'admin inicial si no existeix (variables d'entorn)
const adminEmail = process.env.ADMIN_EMAIL;
const adminPass = process.env.ADMIN_PASSWORD;
if (adminEmail && adminPass) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!exists) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare(`INSERT INTO users (email, password_hash, name, role, email_verified)
                VALUES (?, ?, 'Administrador', 'admin', 1)`).run(adminEmail, hash);
    console.log(`[admin] compte creat: ${adminEmail}`);
  }
}

import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import playerRoutes from './routes/player.js';
import clubRoutes from './routes/club.js';
import adminRoutes from './routes/admin.js';
import inscripcioRoutes from './routes/inscripcions.js';
import { arrencaProgramador } from './lib/programador.js';

app.use('/', authRoutes);
app.use('/', playerRoutes);
app.use('/', clubRoutes);
app.use('/', inscripcioRoutes);
app.use('/admin', adminRoutes);
// public l'últim: té rutes genèriques com /club/:id que no han de
// capturar /club/panel, /club/torneig/nou, etc.
app.use('/', publicRoutes);

app.use((req, res) => res.status(404).render('404', { titol: 'Pàgina no trobada' }));

// Tasques programades internes (resum diari als clubs, recordatoris de tancament)
arrencaProgramador();

app.listen(PORT, () => console.log(`PadelVallès escoltant al port ${PORT}`));
