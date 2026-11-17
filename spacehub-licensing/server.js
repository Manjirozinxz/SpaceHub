'use strict';
require('dotenv').config();
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');

for (const name of ['DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_GUILD_ID','ADMIN_USER_IDS','HWID_PEPPER']) {
  if (!process.env[name] || process.env[name].startsWith('COLOQUE_') || process.env[name].startsWith('SUBSTITUA_')) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
}
if (process.env.HWID_PEPPER.length < 32) throw new Error('HWID_PEPPER precisa ter pelo menos 32 caracteres.');

const dbPath = path.resolve(process.env.DB_PATH || './licenses.db');
const sourcePath = path.resolve(process.env.SOURCE_FILE || './private/SpaceHub.lua');
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS licenses (
 id TEXT PRIMARY KEY,
 key_hash TEXT NOT NULL,
 owner_discord TEXT,
 hwid_hash TEXT,
 expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0,
 reset_count INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 last_used_at INTEGER
);`);
const statements = {
  insert: db.prepare('INSERT INTO licenses (id,key_hash,owner_discord,expires_at,created_at) VALUES (?,?,?,?,?)'),
  byId: db.prepare('SELECT * FROM licenses WHERE id=?'),
  bindHwid: db.prepare('UPDATE licenses SET hwid_hash=?,last_used_at=? WHERE id=?'),
  touch: db.prepare('UPDATE licenses SET last_used_at=? WHERE id=?'),
  revoke: db.prepare('UPDATE licenses SET revoked=1 WHERE id=?'),
  reset: db.prepare('UPDATE licenses SET hwid_hash=NULL,reset_count=reset_count+1 WHERE id=?'),
  extend: db.prepare('UPDATE licenses SET expires_at=? WHERE id=?'),
};
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function hwidHash(text) { return crypto.createHmac('sha256',process.env.HWID_PEPPER).update(text).digest('hex'); }
function makeKey() {
  const id = crypto.randomBytes(6).toString('hex').toUpperCase();
  const secret = crypto.randomBytes(24).toString('hex').toUpperCase();
  return { id, key: `SPACE-${id}-${secret}` };
}
function findKey(key) {
  const m = /^SPACE-([0-9A-F]{12})-([0-9A-F]{48})$/.exec(key);
  if (!m) return null;
  const record = statements.byId.get(m[1]);
  if (!record) return null;
  const actual = Buffer.from(sha256(key),'hex');
  const expected = Buffer.from(record.key_hash,'hex');
  return crypto.timingSafeEqual(actual, expected) ? record : null;
}
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.get('/health', (req, res) => res.json({ok:true, service:'Space Hub License API'}));
const recent = new Map();
setInterval(() => {
  const now=Date.now();
  for (const [ip,v] of recent) if (now-v.since>120000) recent.delete(ip);
},60000).unref();
app.post('/v1/script', (req,res) => {
  res.set('Cache-Control','no-store');
  const ip=req.ip || req.socket.remoteAddress || 'unknown';
  const nowMs=Date.now();
  let usage=recent.get(ip);
  if (!usage || nowMs-usage.since>60000) usage={since:nowMs,count:0};
  usage.count++; recent.set(ip,usage);
  if (usage.count>30) return res.status(429).json({ok:false,error:'Muitas tentativas. Tente novamente mais tarde.'});
  const {key,hwid} = req.body || {};
  if (typeof key!=='string' || key.length>128 || typeof hwid!=='string' || hwid.length<8 || hwid.length>256) {
    return res.status(400).json({ok:false,error:'Key ou HWID ausente/invalido.'});
  }
  const license=findKey(key);
  if (!license) return res.status(401).json({ok:false,error:'Key invalida.'});
  if (license.revoked) return res.status(403).json({ok:false,error:'Key revogada.'});
  const now=Math.floor(nowMs/1000);
  if (license.expires_at<=now) return res.status(403).json({ok:false,error:'Key expirada.'});
  const fingerprint=hwidHash(hwid);
  if (license.hwid_hash && license.hwid_hash!==fingerprint) {
    return res.status(403).json({ok:false,error:'HWID diferente. Solicite reset ao suporte.'});
  }
  if (!fs.existsSync(sourcePath)) return res.status(503).json({ok:false,error:'Source indisponivel no servidor.'});
  if (!license.hwid_hash) statements.bindHwid.run(fingerprint,now,license.id);
  else statements.touch.run(now,license.id);
  const code=fs.readFileSync(sourcePath,'utf8');
  res.type('text/plain; charset=utf-8').send(code);
});

const commands=[
  new SlashCommandBuilder().setName('key-criar').setDescription('Cria uma licenca individual Space Hub')
    .addIntegerOption(x=>x.setName('dias').setDescription('Validade em dias').setRequired(true).setMinValue(1).setMaxValue(3650))
    .addUserOption(x=>x.setName('cliente').setDescription('Dono da licenca (opcional)')),
  new SlashCommandBuilder().setName('key-revogar').setDescription('Revoga uma licenca')
    .addStringOption(x=>x.setName('id').setDescription('ID da key, 12 caracteres').setRequired(true)),
  new SlashCommandBuilder().setName('key-reset').setDescription('Libera a key para vincular outro HWID')
    .addStringOption(x=>x.setName('id').setDescription('ID da key').setRequired(true)),
  new SlashCommandBuilder().setName('key-info').setDescription('Consulta licenca')
    .addStringOption(x=>x.setName('id').setDescription('ID da key').setRequired(true)),
  new SlashCommandBuilder().setName('key-estender').setDescription('Acrescenta dias de validade')
    .addStringOption(x=>x.setName('id').setDescription('ID da key').setRequired(true))
    .addIntegerOption(x=>x.setName('dias').setDescription('Dias adicionais').setRequired(true).setMinValue(1).setMaxValue(3650))
];
const admins=new Set(process.env.ADMIN_USER_IDS.split(',').map(s=>s.trim()).filter(Boolean));
const client=new Client({intents:[GatewayIntentBits.Guilds]});
client.on('interactionCreate',async interaction=>{
  if (!interaction.isChatInputCommand() || !interaction.commandName.startsWith('key-')) return;
  try {
    if (!admins.has(interaction.user.id)) {
      return await interaction.reply({content:'Somente administradores do Space Hub podem usar este comando.',flags:MessageFlags.Ephemeral});
    }
    const cmd=interaction.commandName;
    if (cmd==='key-criar') {
      const days=interaction.options.getInteger('dias');
      const user=interaction.options.getUser('cliente');
      const {id,key}=makeKey();
      const now=Math.floor(Date.now()/1000);
      const expiry=now+days*86400;
      statements.insert.run(id,sha256(key),user?.id||null,expiry,now);
      return await interaction.reply({content:`Licenca criada. Envie esta key ao comprador em privado.\n**ID:** \`${id}\`\n**Validade:** <t:${expiry}:F>\n**Key (mostrada apenas agora):**\n\`${key}\``,flags:MessageFlags.Ephemeral});
    }
    const id=(interaction.options.getString('id')||'').trim().toUpperCase();
    const row=statements.byId.get(id);
    if (!row) return await interaction.reply({content:'Licenca nao encontrada.',flags:MessageFlags.Ephemeral});
    let msg='';
    if (cmd==='key-revogar') {statements.revoke.run(id);msg=`Key ${id} revogada.`;}
    else if (cmd==='key-reset') {statements.reset.run(id);msg=`HWID da key ${id} resetado. A proxima ativacao vincula novo dispositivo.`;}
    else if (cmd==='key-estender') {
      const days=interaction.options.getInteger('dias');
      const expiry=Math.max(row.expires_at,Math.floor(Date.now()/1000))+days*86400;
      statements.extend.run(expiry,id);
      msg=`Validade da key ${id} estendida para <t:${expiry}:F>.`;
    } else if (cmd==='key-info') {
      msg=`**Key ${id}**\nRevogada: ${!!row.revoked}\nHWID vinculado: ${!!row.hwid_hash}\nReset(s): ${row.reset_count}\nCliente: ${row.owner_discord?`<@${row.owner_discord}>`:'Nao atribuido'}\nExpira: <t:${row.expires_at}:F>\nUltimo uso: ${row.last_used_at?`<t:${row.last_used_at}:R>`:'Nunca'}`;
    } else return;
    return await interaction.reply({content:msg,flags:MessageFlags.Ephemeral});
  } catch(err) {
    console.error('[bot]',err);
    if (!interaction.replied) await interaction.reply({content:'Erro interno no bot. Verifique os logs.',flags:MessageFlags.Ephemeral}).catch(()=>{});
  }
});
async function main(){
  const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,process.env.DISCORD_GUILD_ID),{body:commands.map(c=>c.toJSON())});
  console.log('Comandos registrados.');
  await client.login(process.env.DISCORD_TOKEN);
  const port=Number(process.env.PORT||3000);
  app.listen(port,'0.0.0.0',()=>console.log(`API Space Hub ouvindo na porta ${port}`));
}
main().catch(err=>{console.error(err);process.exit(1);});
