// api/build-commandes.js — StoryBeat — PARSER (Étape 2)
// Lit webhooks-bruts/ + questionnaires/ du carnet, fusionne par email, et écrit/met à jour
// une fiche par commande dans commandes/. Protégé par TOOL_PASSWORD, écrit via CARNET_GH_TOKEN.
// Déclenchement MANUEL (ouvrir l'URL). N'écrase jamais un statut modifié à la main.

const OWNER  = 'anitasuljic39-rgb';
const REPO   = 'storybeat-carnet';
const BRANCH = 'main';

// ---------- petites aides ----------
function normEmail(e){ return String(e||'').trim().toLowerCase(); }
function eur(cent){ return Number((Number(cent||0)/100).toFixed(2)); }
function slug(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
function estBump(nom, inner){
  const s = ((nom||'')+' '+(inner||'')).toLowerCase();
  return s.includes('bump') || s.includes('2e chanson') || s.includes('2ᵉ chanson') || s.includes('2ème chanson');
}
function sansMaj(o){ const c = Object.assign({}, o); delete c._maj_le; return JSON.stringify(c); }

module.exports = async (req, res) => {
  const getQuery = (r) => {
    if (r.query) return r.query;
    try { const u = new URL(r.url, 'http://x'); const o={}; u.searchParams.forEach((v,k)=>{o[k]=v;}); return o; }
    catch(e){ return {}; }
  };
  const q = getQuery(req);
  const password = req.headers['x-tool-password'] || q.password || '';
  if (!password || password !== process.env.TOOL_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;
  }
  const token = process.env.CARNET_GH_TOKEN;
  if (!token) { res.status(500).json({ error: 'Configuration serveur incomplète (CARNET_GH_TOKEN).' }); return; }

  const API = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/';
  const H = { 'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json', 'User-Agent':'storybeat-carnet' };

  async function ghList(dir){
    const r = await fetch(API + dir + '?ref=' + BRANCH, { headers: H });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error('Liste ' + dir + ' : GitHub ' + r.status);
    const j = await r.json();
    return Array.isArray(j) ? j.filter(f => f.type==='file' && f.name.endsWith('.json')) : [];
  }
  async function ghGet(path){
    const r = await fetch(API + path + '?ref=' + BRANCH + '&t=' + Date.now(), { headers: H });
    if (r.status === 404) return { data:null, sha:null };
    if (!r.ok) throw new Error('Lecture ' + path + ' : GitHub ' + r.status);
    const f = await r.json();
    let data = null;
    try { data = JSON.parse(Buffer.from(f.content, f.encoding||'base64').toString('utf8')); } catch(e){}
    return { data, sha: f.sha };
  }
  async function ghPut(path, obj, sha, message){
    const body = { message, content: Buffer.from(JSON.stringify(obj,null,2)).toString('base64'), branch: BRANCH };
    if (sha) body.sha = sha;
    const r = await fetch(API + path, { method:'PUT', headers: Object.assign({}, H, {'Content-Type':'application/json'}), body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error('Écriture ' + path + ' : GitHub ' + r.status + ' ' + (e.message||'')); }
  }

  try {
    // ---------- 1) PAIEMENTS ----------
    const whFiles = await ghList('webhooks-bruts');
    const lignes = [];
    for (const f of whFiles) {
      const { data } = await ghGet(f.path);
      let corps = data && (data.corps_json || null);
      if (!corps && data && data.corps_brut) { try { corps = JSON.parse(data.corps_brut); } catch(e){} }
      if (!corps || !corps.data) continue;
      const d = corps.data;
      lignes.push({
        email: normEmail(d.customer && d.customer.email),
        order_id: d.order && d.order.id,
        formule: d.funnel_step && d.funnel_step.name,
        nom: d.price_plan && d.price_plan.name,
        inner: d.price_plan && d.price_plan.inner_name,
        montant: d.price_plan && d.price_plan.amount,
        date: d.created_at || (d.order && d.order.created_at)
      });
    }

    // ---------- 2) REGROUPER par order.id ----------
    const commandes = {};
    for (const l of lignes) {
      const id = (l.order_id != null) ? String(l.order_id) : ('sans-id-' + (slug(l.email)||'x') + '-' + slug(l.date||''));
      if (!commandes[id]) commandes[id] = { order_id:l.order_id, id_key:id, email:l.email, formule:l.formule, date:l.date, lignes:[] };
      const c = commandes[id];
      c.lignes.push({ nom:l.nom, montant_eur:eur(l.montant), bump:estBump(l.nom, l.inner) });
      if (!c.email) c.email = l.email;
      if (!c.formule) c.formule = l.formule;
      if (l.date && (!c.date || l.date < c.date)) c.date = l.date;
    }

    // ---------- 3) QUESTIONNAIRES indexés par email ----------
    const qFiles = await ghList('questionnaires');
    const parEmail = {};
    for (const f of qFiles) {
      const { data } = await ghGet(f.path);
      if (!data) continue;
      const rep = data.reponses || {};
      const email = normEmail(data.email || rep.email);
      const cb = rep.chanson;
      const item = {
        email,
        chanson: (cb===2 || cb==='2') ? 2 : 1,
        chanson_precisee: (cb!==undefined && cb!==null && cb!==''),
        categorie: rep.categorie || null,
        histoire: rep.message_lisible || '',
        _utilise: false
      };
      (parEmail[email] = parEmail[email] || []).push(item);
    }
    function prendre(email, n){
      const liste = parEmail[email] || [];
      let x = liste.find(v => !v._utilise && v.chanson_precisee && v.chanson===n);
      if (!x && n===1) x = liste.find(v => !v._utilise && !v.chanson_precisee);
      if (!x) x = liste.find(v => !v._utilise);
      if (x) x._utilise = true;
      return x || null;
    }

    // ---------- 4) CONSTRUIRE + ÉCRIRE chaque fiche ----------
    const crees=[], majs=[], inchanges=[], erreurs=[];
    const maintenant = new Date().toISOString();

    for (const id of Object.keys(commandes)) {
      const c = commandes[id];
      const total = c.lignes.reduce((s,l)=> s + Number(l.montant_eur||0), 0);
      const nbChansons = 1 + c.lignes.filter(l=>l.bump).length;
      const chansons = [];
      for (let n=1; n<=nbChansons; n++) {
        const qq = prendre(c.email, n);
        if (qq) chansons.push({ numero:n, questionnaire:'présent', chanson_precisee:qq.chanson_precisee, categorie:qq.categorie, histoire:qq.histoire });
        else    chansons.push({ numero:n, questionnaire:'en attente' });
      }
      const nouvelle = {
        order_id: c.order_id != null ? c.order_id : null,
        email: c.email,
        formule: c.formule || null,
        lignes: c.lignes,
        montant_total_eur: Number(total.toFixed(2)),
        date: c.date || null,
        nb_chansons: nbChansons,
        chansons: chansons
      };

      const filename = 'commandes/commande-' + (c.order_id != null ? c.order_id : c.id_key) + '.json';
      try {
        const { data: existante, sha } = await ghGet(filename);
        let finale;
        if (!existante) {
          finale = Object.assign({}, nouvelle, { statut: 'à traiter' });
        } else {
          // on part de l'existante (garde statut manuel + champs perso), on superpose les champs issus des données
          finale = Object.assign({}, existante, nouvelle);
          finale.statut = existante.statut || 'à traiter'; // JAMAIS retouché après création
        }
        delete finale._maj_le;
        const change = !existante || (sansMaj(finale) !== sansMaj(existante));
        if (change) {
          finale._maj_le = maintenant;
          await ghPut(filename, finale, sha, (existante ? 'Parser: MAJ ' : 'Parser: création ') + filename);
          (existante ? majs : crees).push(filename);
        } else {
          inchanges.push(filename);
        }
      } catch (e) {
        erreurs.push({ fichier: filename, erreur: e.message });
      }
    }

    res.status(200).json({
      ok: true,
      resume: {
        commandes_traitees: Object.keys(commandes).length,
        creees: crees.length,
        mises_a_jour: majs.length,
        inchangees: inchanges.length,
        erreurs: erreurs.length
      },
      creees: crees, mises_a_jour: majs, inchangees: inchanges, erreurs: erreurs
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur parser : ' + e.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
