import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieSession({ name: 'tuyyi.sid', keys: [process.env.SESSION_SECRET || 'development-only-change-me'], httpOnly: true, sameSite: 'strict', secure: isProd, maxAge: 8 * 60 * 60 * 1000, signed: true }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false }));
// Vercel Functions impose a small incoming request-body limit. Keep uploads below it.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });
const safeEqual = (a, b) => { const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); };
const needAuth = (req, res, next) => req.session?.authenticated && req.session?.expiresAt > Date.now() ? next() : res.status(401).json({ error: 'Sesi berakhir. Silakan login kembali.' });
const requireConfig = (...keys) => { const missing = keys.filter(k => !process.env[k]); if (missing.length) throw Object.assign(new Error(`Konfigurasi belum diisi: ${missing.join(', ')}`), { status: 400 }); };
async function api(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const body = await response.text(); let data; try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body }; }
  if (!response.ok) throw Object.assign(new Error(data.message || data.error?.message || `API error ${response.status}`), { status: response.status });
  return data;
}
const gh = (url, options) => api(url, process.env.GITHUB_TOKEN, options);
const vc = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const body = await response.text(); let data; try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body }; }
  if (!response.ok) throw Object.assign(new Error(data.error?.message || data.message || `Vercel API error ${response.status}`), { status: response.status });
  return data;
};
app.get('/api/status', (req, res) => res.json({ authenticated: !!req.session?.authenticated && req.session?.expiresAt > Date.now(), configured: { pin: !!process.env.DASHBOARD_PIN, github: !!process.env.GITHUB_TOKEN, vercel: !!process.env.VERCEL_TOKEN }, owner: process.env.GITHUB_OWNER || '' }));
app.post('/api/auth/login', (req, res) => {
  if (!process.env.DASHBOARD_PIN || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.includes('replace-with') || process.env.SESSION_SECRET === 'development-only-change-me') return res.status(503).json({ error: 'Atur DASHBOARD_PIN dan SESSION_SECRET acak minimal 32 karakter di Environment Variables.' });
  if (!safeEqual(req.body?.pin || '', process.env.DASHBOARD_PIN)) return res.status(401).json({ error: 'PIN salah.' });
  req.session = { authenticated: true, expiresAt: Date.now() + 8 * 60 * 60 * 1000, nonce: crypto.randomBytes(16).toString('hex') }; res.json({ ok: true });
});
app.post('/api/auth/logout', needAuth, (req, res) => { req.session = null; res.json({ ok: true }); });
app.use('/api', needAuth);
app.get('/api/overview', async (req, res, next) => { try { const result = { github: null, vercel: null }; if (process.env.GITHUB_TOKEN) { try { const repos = await gh(`https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member`); result.github = { count: repos.length }; } catch(e) { result.github = { error: e.message }; } } if (process.env.VERCEL_TOKEN) { try { const p = await vc('https://api.vercel.com/v9/projects?limit=100'); result.vercel = { count: (p.projects || []).length }; } catch(e) { result.vercel = { error: e.message }; } } res.json(result); } catch(e) { next(e); } });
app.get('/api/github/repos', async (req,res,next) => { try { requireConfig('GITHUB_TOKEN'); const owner = req.query.owner || process.env.GITHUB_OWNER; const url = owner ? `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated` : 'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member'; const repos = await gh(url); res.json(repos.map(r => ({ id:r.id, name:r.name, full_name:r.full_name, private:r.private, default_branch:r.default_branch, html_url:r.html_url, description:r.description, updated_at:r.updated_at, permissions:r.permissions }))); } catch(e){next(e);} });
app.get('/api/github/tree/:owner/:repo', async(req,res,next)=>{try{requireConfig('GITHUB_TOKEN'); const branch=req.query.branch||'main'; const data=await gh(`https://api.github.com/repos/${encodeURIComponent(req.params.owner)}/${encodeURIComponent(req.params.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`); res.json({truncated:data.truncated,tree:(data.tree||[]).map(x=>({path:x.path,type:x.type,size:x.size,sha:x.sha})).filter(x=>x.type==='blob'||x.type==='tree')});}catch(e){next(e);}});
app.get('/api/github/file/:owner/:repo', async(req,res,next)=>{try{requireConfig('GITHUB_TOKEN'); const p=String(req.query.path||''); if(!p||p.split('/').includes('..')) return res.status(400).json({error:'Path file tidak valid.'}); const branch=req.query.branch||'main'; const d=await gh(`https://api.github.com/repos/${encodeURIComponent(req.params.owner)}/${encodeURIComponent(req.params.repo)}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`); if(Array.isArray(d)||d.type!=='file') return res.status(400).json({error:'Path bukan file.'}); if(d.size>1024*1024) return res.status(413).json({error:'File terlalu besar untuk editor (maksimum 1 MB).'}); const content=Buffer.from(d.content||'','base64').toString('utf8'); res.json({path:d.path,sha:d.sha,size:d.size,content,download_url:d.download_url});}catch(e){next(e);}});
app.get('/api/github/download/:owner/:repo', async(req,res,next)=>{try{requireConfig('GITHUB_TOKEN'); const branch=req.query.branch||'main'; const d=await fetch(`https://api.github.com/repos/${encodeURIComponent(req.params.owner)}/${encodeURIComponent(req.params.repo)}/zipball/${encodeURIComponent(branch)}`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'}}); if(!d.ok) throw new Error(`GitHub download gagal (${d.status})`); res.setHeader('Content-Type','application/zip'); res.setHeader('Content-Disposition',`attachment; filename="${req.params.repo}-${branch}.zip"`); d.body.pipeTo(new WritableStream({write(chunk){res.write(Buffer.from(chunk));},close(){res.end();},abort(){res.end();}})).catch(next);}catch(e){next(e);}});
app.put('/api/github/file/:owner/:repo', async(req,res,next)=>{try{requireConfig('GITHUB_TOKEN'); const {path:p,content,branch='main',message='Update file from Tuyyi Control',sha}=req.body||{}; if(!p||p.split('/').includes('..')||typeof content!=='string') return res.status(400).json({error:'Path atau isi file tidak valid.'}); const body={message,content:Buffer.from(content,'utf8').toString('base64'),branch}; if(sha) body.sha=sha; const d=await gh(`https://api.github.com/repos/${encodeURIComponent(req.params.owner)}/${encodeURIComponent(req.params.repo)}/contents/${p.split('/').map(encodeURIComponent).join('/')}`,{method:'PUT',body:JSON.stringify(body)}); res.json({ok:true,commit:d.commit?.html_url,sha:d.content?.sha});}catch(e){next(e);}});
app.post('/api/github/zip/:owner/:repo', upload.single('zip'), async(req,res,next)=>{try{requireConfig('GITHUB_TOKEN'); if(!req.file) return res.status(400).json({error:'Pilih file ZIP terlebih dahulu.'}); if(!req.file.originalname.toLowerCase().endsWith('.zip')) return res.status(400).json({error:'File harus berformat ZIP.'}); const branch=req.body.branch||'main', target=(req.body.target||'').replace(/^\/+|\/+$/g,''); if(target.split('/').includes('..')||target.includes('\\')) throw Object.assign(new Error('Folder tujuan tidak valid.'),{status:400}); const zip=new AdmZip(req.file.buffer); const entries=zip.getEntries().filter(e=>!e.isDirectory); if(!entries.length) return res.status(400).json({error:'ZIP tidak berisi file.'}); if(entries.length>100) return res.status(400).json({error:'Maksimum 100 file per upload pada hosting serverless.'}); let total=0; const files=[]; for(const entry of entries){ const raw=entry.entryName.replace(/\\/g,'/'); if(raw.startsWith('/')||raw.split('/').includes('..')||raw.includes('\0')) throw Object.assign(new Error('ZIP berisi path yang tidak aman.'),{status:400}); const data=entry.getData(); total+=data.length; if(total>20*1024*1024) throw Object.assign(new Error('Total hasil ekstraksi ZIP maksimal 20 MB di Vercel serverless.'),{status:413}); const clean=raw.replace(/^\.\//,''); if(!clean) continue; files.push({path:[target,clean].filter(Boolean).join('/'),data}); } if(!files.length) return res.status(400).json({error:'Tidak ada file yang valid.'}); const repo=`https://api.github.com/repos/${encodeURIComponent(req.params.owner)}/${encodeURIComponent(req.params.repo)}`; const ref=await gh(`${repo}/git/ref/heads/${encodeURIComponent(branch)}`); const base=await gh(`${repo}/git/commits/${ref.object.sha}`); const blobs=[]; for(const f of files){ const b=await gh(`${repo}/git/blobs`,{method:'POST',body:JSON.stringify({content:f.data.toString('base64'),encoding:'base64'})}); blobs.push({path:f.path,mode:'100644',type:'blob',sha:b.sha}); } const tree=await gh(`${repo}/git/trees`,{method:'POST',body:JSON.stringify({base_tree:base.tree.sha,tree:blobs})}); const commit=await gh(`${repo}/git/commits`,{method:'POST',body:JSON.stringify({message:req.body.message||`Upload ZIP via Tuyyi Control (${files.length} files)`,tree:tree.sha,parents:[base.sha]})}); await gh(`${repo}/git/refs/heads/${encodeURIComponent(branch)}`,{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})}); res.json({ok:true,count:files.length,commit:`https://github.com/${req.params.owner}/${req.params.repo}/commit/${commit.sha}`,files:files.map(f=>f.path)});}catch(e){next(e);}});
app.patch('/api/github/repo/:owner/:repo/visibility',async(req,res,next)=>{try{requireConfig('GITHUB_TOKEN'); if(!['private','public'].includes(req.body.visibility)) return res.status(400).json({error:'Visibilitas tidak valid.'}); if(req.body.confirm!==req.params.repo) return res.status(400).json({error:'Ketik nama repository dengan benar untuk konfirmasi.'}); const d=await gh(`https://api.github.com/repos/${encodeURIComponent(req.params.owner)}/${encodeURIComponent(req.params.repo)}`,{method:'PATCH',body:JSON.stringify({private:req.body.visibility==='private'})}); res.json({ok:true,private:d.private});}catch(e){next(e);}});
app.post('/api/vercel/deploy', upload.single('zip'), async(req,res,next)=>{try{
  requireConfig('VERCEL_TOKEN');
  if(!req.file)return res.status(400).json({error:'Pilih source ZIP terlebih dahulu.'});
  if(!req.file.originalname.toLowerCase().endsWith('.zip'))return res.status(400).json({error:'File harus ZIP.'});
  const name=String(req.body.name||'').toLowerCase();
  if(!/^[a-z0-9-]{1,52}$/.test(name))return res.status(400).json({error:'Nama project hanya boleh huruf kecil, angka, dan tanda hubung.'});
  const zip=new AdmZip(req.file.buffer); const entries=zip.getEntries().filter(e=>!e.isDirectory);
  if(!entries.length||entries.length>100)return res.status(400).json({error:'ZIP harus berisi 1–100 file.'});
  let total=0; const files=[];
  for(const entry of entries){
    const raw=entry.entryName.replace(/\\/g,'/');
    if(raw.startsWith('/')||raw.split('/').includes('..')||raw.includes('\0'))throw Object.assign(new Error('ZIP berisi path yang tidak aman.'),{status:400});
    const data=entry.getData(); total+=data.length;
    if(total>3*1024*1024)throw Object.assign(new Error('Total hasil ekstraksi maksimal 3 MB untuk deployment ZIP langsung di Vercel. Untuk project besar, hubungkan repository GitHub ke Vercel.'),{status:413});
    const file=raw.replace(/^\.\//,''); if(!file)continue;
    files.push({file,data:data.toString('base64'),encoding:'base64'});
  }
  if(!files.length)return res.status(400).json({error:'ZIP tidak berisi file yang valid.'});
  const payload={name,files,target:req.body.target==='production'?'production':'preview'};
  const d=await vc('https://api.vercel.com/v13/deployments',{method:'POST',body:JSON.stringify(payload)});
  res.json({ok:true,name,id:d.id||null,state:d.readyState||d.status||'QUEUED',url:d.url?`https://${d.url}`:null,inspectionUrl:d.inspectorUrl||null,message:'Deployment dibuat melalui Vercel API. Periksa status deployment untuk memastikan build selesai.'});
}catch(e){next(e);}});
app.get('/api/vercel/projects',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN'); const d=await vc('https://api.vercel.com/v9/projects?limit=100'); res.json((d.projects||[]).map(p=>({id:p.id,name:p.name,framework:p.framework,createdAt:p.createdAt,updatedAt:p.updatedAt,link:p.link,domains:p.targets?.production?.alias||[]})));}catch(e){next(e);}});
app.get('/api/vercel/project/:project/env',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN'); const d=await vc(`https://api.vercel.com/v10/projects/${encodeURIComponent(req.params.project)}/env`); res.json((d.envs||[]).map(v=>({id:v.id,key:v.key,type:v.type,target:v.target,gitBranch:v.gitBranch,createdAt:v.createdAt,updatedAt:v.updatedAt})));}catch(e){next(e);}});
app.post('/api/vercel/project/:project/env',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN'); const {key,value,target=['production','preview','development'],type='encrypted',gitBranch}=req.body||{}; if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key||'')||typeof value!=='string'||!value.length) return res.status(400).json({error:'Nama atau nilai environment variable tidak valid.'}); const payload={key,value,type,target:Array.isArray(target)?target:[target]}; if(gitBranch)payload.gitBranch=gitBranch; const d=await vc(`https://api.vercel.com/v10/projects/${encodeURIComponent(req.params.project)}/env`,{method:'POST',body:JSON.stringify(payload)}); res.json({ok:true,id:d.id||d.created?.[0]?.id});}catch(e){next(e);}});
app.patch('/api/vercel/project/:project/env/:envId',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN'); const {value,target,type='encrypted'}=req.body||{}; if(typeof value!=='string'||!value.length)return res.status(400).json({error:'Nilai baru wajib diisi.'}); const payload={value,type}; if(target)payload.target=Array.isArray(target)?target:[target]; const d=await vc(`https://api.vercel.com/v9/projects/${encodeURIComponent(req.params.project)}/env/${encodeURIComponent(req.params.envId)}`,{method:'PATCH',body:JSON.stringify(payload)});res.json({ok:true,id:d.id});}catch(e){next(e);}});
app.delete('/api/vercel/project/:project/env/:envId',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN'); if(req.body?.confirm!=='DELETE')return res.status(400).json({error:'Konfirmasi DELETE diperlukan.'}); await vc(`https://api.vercel.com/v9/projects/${encodeURIComponent(req.params.project)}/env/${encodeURIComponent(req.params.envId)}`,{method:'DELETE'});res.json({ok:true});}catch(e){next(e);}});
app.delete('/api/vercel/project/:project',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN'); if(req.body?.confirm!==req.params.project)return res.status(400).json({error:'Ketik nama project untuk konfirmasi.'}); await vc(`https://api.vercel.com/v9/projects/${encodeURIComponent(req.params.project)}`,{method:'DELETE'});res.json({ok:true});}catch(e){next(e);}});
app.get('/api/vercel/project/:project/domains',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN'); const d=await vc(`https://api.vercel.com/v9/projects/${encodeURIComponent(req.params.project)}/domains`);res.json(d.domains||[]);}catch(e){next(e);}});
app.post('/api/vercel/project/:project/domains',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN');const domain=String(req.body?.domain||'').trim().toLowerCase();if(!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain))return res.status(400).json({error:'Nama domain tidak valid.'});const d=await vc(`https://api.vercel.com/v10/projects/${encodeURIComponent(req.params.project)}/domains`,{method:'POST',body:JSON.stringify({name:domain})});res.json({ok:true,domain:d.name||domain,verified:d.verified});}catch(e){next(e);}});
app.delete('/api/vercel/project/:project/domains/:domain',async(req,res,next)=>{try{requireConfig('VERCEL_TOKEN');if(req.body?.confirm!==req.params.domain)return res.status(400).json({error:'Ketik nama domain untuk konfirmasi.'});await vc(`https://api.vercel.com/v9/projects/${encodeURIComponent(req.params.project)}/domains/${encodeURIComponent(req.params.domain)}`,{method:'DELETE'});res.json({ok:true});}catch(e){next(e);}});
// Static dashboard
app.use(express.static(path.join(__dirname,'public'), { etag:true, maxAge:isProd?'1h':0 }));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error('[api]',err.status||500,err.message); if(res.headersSent)return next(err);res.status(err.status||500).json({error:err.message||'Terjadi kesalahan server.'});});
export default app;
if (process.env.VERCEL !== '1') app.listen(PORT,()=>console.log(`Tuyyi Control running on http://localhost:${PORT}`));
