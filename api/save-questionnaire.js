// api/save-questionnaire.js — StoryBeat
// Enregistre DURABLEMENT les réponses du questionnaire client dans le dépôt privé
// storybeat-carnet, dossier questionnaires/. Même mécanisme d'écriture GitHub que
// webhook-systeme.js, mêmes variables (CARNET_GH_TOKEN). Ne touche à aucun fichier existant.
// Différence avec l'attrapeur de webhooks : ici on renvoie de VRAIES erreurs (le
// questionnaire doit pouvoir réagir) et on autorise le CORS pour questionnaire.storybeat.fr.

const OWNER  = 'anitasuljic39-rgb';
const REPO   = 'storybeat-carnet';
const BRANCH = 'main';
const DIR    = 'questionnaires';
const ALLOW_ORIGIN = 'https://questionnaire.storybeat.fr';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readRaw(req) {
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') return resolve(JSON.stringify(req.body));
    let d = '';
    try {
      req.on('data', c => { d += c; });
      req.on('end', () => resolve(d));
      req.on('error', () => resolve(d));
    } catch (e) { resolve(''); }
  });
}

function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

module.exports = async (req, res) => {
  setCors(res);

  // Requête « pré-vol » du navigateur (obligatoire pour un POST JSON cross-domaine)
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Un GET dans le navigateur = petit test « je suis en vie »
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, message: 'Endpoint save-questionnaire en ligne. Envoie les réponses en POST (JSON).' });
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'Méthode non autorisée.' }); return; }

  // Lecture + analyse du corps JSON
  const raw = await readRaw(req);
  let body = null;
  try { body = JSON.parse(raw); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Corps JSON manquant ou invalide.' }); return; }

  const reponses = body.reponses || body.answers || body;
  const email = String(body.email || (reponses && reponses.email) || '').trim().toLowerCase();
  if (!isValidEmail(email)) { res.status(400).json({ error: 'Email de la cliente manquant ou invalide.' }); return; }

  const token = process.env.CARNET_GH_TOKEN;
  if (!token) { res.status(500).json({ error: 'Configuration serveur incomplète (CARNET_GH_TOKEN).' }); return; }

  // Nom de fichier : email nettoyé + date-heure (UTC) + petit code anti-collision
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  const code = Math.random().toString(36).slice(2, 6);
  const slug = email.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sans-email';
  const path = DIR + '/' + slug + '-' + stamp + '-' + code + '.json';

  const enregistrement = {
    recu_le: d.toISOString(),
    email: email,
    reponses: reponses
  };

  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path;
  const ghBody = {
    message: 'Questionnaire reçu : ' + email,
    content: Buffer.from(JSON.stringify(enregistrement, null, 2)).toString('base64'),
    branch: BRANCH
  };

  try {
    const r = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'storybeat-carnet',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(ghBody)
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      res.status(502).json({ error: 'Échec de l’enregistrement (GitHub ' + r.status + ' : ' + (e.message || 'erreur') + ').' });
      return;
    }
    res.status(200).json({ ok: true, fichier: path });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de l’enregistrement : ' + e.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
