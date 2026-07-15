// api/set-statut.js — StoryBeat
// Change UNIQUEMENT le champ "statut" d'une fiche commande (commandes/commande-{order_id}.json).
// Tout le reste de la fiche est laissé intact. Protégé par TOOL_PASSWORD, écrit via CARNET_GH_TOKEN.
// N'entre pas en conflit avec le parser : build-commandes ne réécrit jamais le statut.

const OWNER  = 'anitasuljic39-rgb';
const REPO   = 'storybeat-carnet';
const BRANCH = 'main';
const STATUTS = ['à traiter', 'en cours', 'livrée', 'remboursée'];

function readRaw(req){
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') return resolve(JSON.stringify(req.body));
    let d = '';
    try { req.on('data', c=>{ d+=c; }); req.on('end', ()=>resolve(d)); req.on('error', ()=>resolve(d)); }
    catch(e){ resolve(''); }
  });
}

// Cherche la fiche commande dont prod_id (chanson 1) ou prod_id_2 (chanson 2) == idExtrait.
// Scanne le dossier commandes/ (comme carnet-list). Retourne {path, fiche, sha, chanson} ou null.
async function findCommandeByExtrait(idExtrait, H){
  const base = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/';
  const lr = await fetch(base + 'commandes?ref=' + BRANCH + '&t=' + Date.now(), { headers: H });
  if (!lr.ok) return null;
  const items = await lr.json();
  if (!Array.isArray(items)) return null;
  for (const it of items) {
    if (!it || it.type !== 'file' || !/\.json$/i.test(it.name || '')) continue;
    const fr = await fetch(base + it.path + '?ref=' + BRANCH + '&t=' + Date.now(), { headers: H });
    if (!fr.ok) continue;
    let f; try { f = await fr.json(); } catch(e){ continue; }
    let fiche;
    try { fiche = JSON.parse(Buffer.from(f.content, f.encoding||'base64').toString('utf8')); } catch(e){ continue; }
    const p1 = fiche.prod_id   ? String(fiche.prod_id).toLowerCase()   : null;
    const p2 = fiche.prod_id_2 ? String(fiche.prod_id_2).toLowerCase() : null;
    if (p1 && p1 === idExtrait) return { path: it.path, fiche: fiche, sha: f.sha, chanson: 1 };
    if (p2 && p2 === idExtrait) return { path: it.path, fiche: fiche, sha: f.sha, chanson: 2 };
  }
  return null;
}

// Branche publique : écrit des champs dédiés (remboursement_demande / validation) dans la
// fiche commande retrouvée via l'id d'extrait. Ne touche JAMAIS au statut. Non-bloquant :
// en cas de souci (commande introuvable, config, GitHub), répond proprement sans planter.
async function handlePublicEvent(res, body, type){
  try {
    const token = process.env.CARNET_GH_TOKEN;
    if (!token) { res.status(200).json({ ok:false, error:'config serveur (CARNET_GH_TOKEN)' }); return; }

    // id_extrait → prod_id : on retire le suffixe "-choix", puis on nettoie comme un prod_id.
    let idExtrait = String(body.id_extrait != null ? body.id_extrait : (body.id != null ? body.id : '')).trim().toLowerCase();
    idExtrait = idExtrait.replace(/-choix$/, '').replace(/[^a-z0-9-]/g, '');
    if (!idExtrait) { res.status(400).json({ ok:false, error:'id_extrait manquant' }); return; }

    const version = (body.version != null && String(body.version).trim() !== '') ? String(body.version).trim() : null;
    const H = { 'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json', 'User-Agent':'storybeat-carnet' };

    const found = await findCommandeByExtrait(idExtrait, H);
    if (!found) { res.status(200).json({ ok:false, matched:false, id_extrait:idExtrait }); return; }

    const { path, fiche, sha, chanson } = found;
    const now = new Date().toISOString();
    if (type === 'remboursement') {
      fiche.remboursement_demande = true;
      fiche._remb_le = now;
      fiche.remb_chanson = chanson;
    } else { // validation
      fiche.validation = { version: version, chanson: chanson, valide_le: now };
    }

    const putR = await fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path, {
      method: 'PUT',
      headers: Object.assign({}, H, {'Content-Type':'application/json'}),
      body: JSON.stringify({
        message: 'Événement ' + type + ' — commande ' + (fiche.order_id!=null?fiche.order_id:'?') + ' (chanson ' + chanson + ')',
        content: Buffer.from(JSON.stringify(fiche, null, 2)).toString('base64'),
        sha: sha,
        branch: BRANCH
      })
    });
    if (!putR.ok) { const e = await putR.json().catch(()=>({})); res.status(200).json({ ok:false, error:'écriture GitHub '+putR.status+' : '+(e.message||'') }); return; }

    res.status(200).json({ ok:true, type:type, order_id: (fiche.order_id!=null?fiche.order_id:null), chanson:chanson });
  } catch (e) {
    res.status(200).json({ ok:false, error: e.message });
  }
}

module.exports = async (req, res) => {
  // ─── CORS : la page publique de validation (ecoute.storybeat.fr) appelle cet endpoint
  //     en cross-domaine. On autorise le préflight OPTIONS et les en-têtes nécessaires.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-tool-password');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // On lit le corps UNE seule fois puis on le remet dans req.body (string), pour que la
  // logique password ci-dessous (readRaw) le retrouve sans reconsommer le flux de requête.
  const rawTop = await readRaw(req);
  req.body = rawTop;
  let bodyTop = {}; try { bodyTop = rawTop ? (JSON.parse(rawTop) || {}) : {}; } catch(e){ bodyTop = {}; }
  const evType = String(bodyTop.type || '').trim().toLowerCase();

  // ─── BRANCHE PUBLIQUE (sans mot de passe) : événements de la page de validation.
  //     Écrit des CHAMPS DÉDIÉS (jamais le statut). Trouve la commande via prod_id/prod_id_2.
  if (evType === 'validation' || evType === 'remboursement') {
    return handlePublicEvent(res, bodyTop, evType);
  }

  // ─── BRANCHE PASSWORD (carnet) — inchangée. ───
  const getQuery = (r) => {
    if (r.query) return r.query;
    try { const u = new URL(r.url, 'http://x'); const o={}; u.searchParams.forEach((v,k)=>{o[k]=v;}); return o; }
    catch(e){ return {}; }
  };
  const q = getQuery(req);

  // Entrées possibles : paramètres d'URL ET/OU corps JSON (le corps a priorité s'il est présent).
  const raw = await readRaw(req);
  let body = {}; try { body = raw ? (JSON.parse(raw) || {}) : {}; } catch(e){ body = {}; }
  const p = Object.assign({}, q, body);

  const password = req.headers['x-tool-password'] || p.password || '';
  if (!password || password !== process.env.TOOL_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;
  }

  const orderRaw = String(p.order_id != null ? p.order_id : (p.order != null ? p.order : '')).trim();
  if (!orderRaw) { res.status(400).json({ error: 'Numéro de commande manquant (order_id).' }); return; }
  // anti-piège chemin : uniquement chiffres/lettres/tirets (couvre aussi les clés "sans-id-...")
  if (!/^[a-zA-Z0-9-]+$/.test(orderRaw)) { res.status(400).json({ error: 'Numéro de commande invalide.' }); return; }

  // statut, prod_id ET prod_id_2 sont OPTIONNELS : on fournit l'un OU l'autre (ou plusieurs).
  // prod_id_2 = identifiant de la 2e chanson d'une commande order bump (optionnel, rétrocompatible).
  const statut = (p.statut != null && String(p.statut).trim() !== '') ? String(p.statut).trim() : null;
  const prodId = (p.prod_id != null && String(p.prod_id).trim() !== '')
    ? String(p.prod_id).trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : null;
  const prodId2 = (p.prod_id_2 != null && String(p.prod_id_2).trim() !== '')
    ? String(p.prod_id_2).trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : null;
  if (statut === null && !prodId && !prodId2) {
    res.status(400).json({ error: 'Rien à mettre à jour (statut, prod_id ou prod_id_2 requis).' }); return;
  }
  if (statut !== null && STATUTS.indexOf(statut) === -1) {
    res.status(400).json({ error: 'Statut invalide (attendus : ' + STATUTS.join(' / ') + ').' }); return;
  }

  const token = process.env.CARNET_GH_TOKEN;
  if (!token) { res.status(500).json({ error: 'Configuration serveur incomplète (CARNET_GH_TOKEN).' }); return; }

  const path = 'commandes/commande-' + orderRaw + '.json';
  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path;
  const H = { 'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json', 'User-Agent':'storybeat-carnet' };

  try {
    // 1) lire la fiche existante (+ sha)
    const getR = await fetch(url + '?ref=' + BRANCH + '&t=' + Date.now(), { headers: H });
    if (getR.status === 404) { res.status(404).json({ error: 'Commande ' + orderRaw + ' introuvable.' }); return; }
    if (!getR.ok) { res.status(502).json({ error: 'Lecture GitHub ' + getR.status }); return; }
    const f = await getR.json();
    let fiche;
    try { fiche = JSON.parse(Buffer.from(f.content, f.encoding||'base64').toString('utf8')); }
    catch(e){ res.status(500).json({ error: 'Fiche commande illisible.' }); return; }

    const ancien = fiche.statut || null;
    // 2) modifier SEULEMENT les champs fournis (statut et/ou prod_id), sans toucher au reste
    const now = new Date().toISOString();
    if (statut !== null) { fiche.statut = statut; fiche._statut_maj_le = now; }
    if (prodId) { fiche.prod_id = prodId; fiche._prod_maj_le = now; }
    if (prodId2) { fiche.prod_id_2 = prodId2; fiche._prod2_maj_le = now; }

    const changes = [];
    if (statut !== null) changes.push('statut → ' + statut);
    if (prodId) changes.push('prod_id → ' + prodId);
    if (prodId2) changes.push('prod_id_2 → ' + prodId2);

    // 3) réécrire en place (avec sha → pas de doublon)
    const putR = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({}, H, {'Content-Type':'application/json'}),
      body: JSON.stringify({
        message: 'MAJ commande ' + orderRaw + ' : ' + changes.join(', '),
        content: Buffer.from(JSON.stringify(fiche, null, 2)).toString('base64'),
        sha: f.sha,
        branch: BRANCH
      })
    });
    if (!putR.ok) { const e = await putR.json().catch(()=>({})); res.status(502).json({ error: 'Écriture GitHub ' + putR.status + ' : ' + (e.message||'') }); return; }

    res.status(200).json({ ok: true, order_id: orderRaw, ancien_statut: ancien, nouveau_statut: statut, prod_id: fiche.prod_id || null, prod_id_2: fiche.prod_id_2 || null });
  } catch (e) {
    res.status(500).json({ error: 'Erreur : ' + e.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
