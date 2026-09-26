export function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/entra?next=' + encodeURIComponent(req.originalUrl));
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/entra');
    if (!roles.includes(req.session.user.role)) return res.status(403).send('Accés denegat.');
    next();
  };
}

// El club ha de tenir el compte verificat per publicar
export function requireVerified(req, res, next) {
  if (!req.session.user?.email_verified) {
    return res.redirect('/elmeucompte?avisa=verifica');
  }
  next();
}
