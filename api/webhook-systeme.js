// api/webhook-systeme.js — StoryBeat
// MODE ATTRAPEUR : reçoit ce que Systeme.io (ou Stripe) envoie lors d'un paiement
// et l'enregistre TEL QUEL dans le dépôt privé storybeat-carnet, dossier webhooks-bruts/.
// But : découvrir le format réel du payload avant de construire le vrai récepteur.
// Ne touche à aucun fichier existant. Réutilise CARNET_GH_TOKEN (déjà en place).

const OWNER = 'anitasuljic39-rgb';
const REPO  = 'storybeat-carnet';
const BRANCH = 'main';
const DIR   = 'webhooks-bruts';

function readRaw(req){
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') return resolve(JSON.stringify(req.body));
    let d = '';
    try {
      req.on('data', c => { d += c; });
      req.on('end', () => resolve(d));
      req.on('error', () => resolve(d));
    } catch(e) { resolve(''); }
  });
}

module.exports = async (req, res) => {
  // Un simple GET dans le navigateur = test "je suis en vie"
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, message: 'Attrapeur StoryBeat en ligne. En attente des webhooks (POST).' });
    return;
  }

  const raw = await readRaw(req);
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch(e) { parsed = null; }

  const capture = {
    recu_le: new Date().toISOString(),
    method: req.method,
    headers: req.headers || {},
    corps_brut: raw,
    corps_json: parsed
  };

  const token = process.env.CARNET_GH_TOKEN;
  // On répond TOUJOURS 200 au webhook (sinon Systeme.io réessaie en boucle),
  // même si l'enregistrement échoue.
  if (!token) { res.status(200).json({ ok: false, note: 'token manquant, rien enregistré' }); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const code = Math.random().toString(36).slice(2,6);
  const path = DIR + '/' + stamp + '-' + code + '.json';
  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path;
  const body = {
    message: 'Webhook capturé ' + stamp,
    content: Buffer.from(JSON.stringify(capture, null, 2)).toString('base64'),
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
      body: JSON.stringify(body)
    });
    if (!r.ok) { res.status(200).json({ ok: false, note: 'échec écriture (' + r.status + ')' }); return; }
    res.status(200).json({ ok: true, fichier: path });
  } catch (e) {
    res.status(200).json({ ok: false, note: 'erreur : ' + e.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
