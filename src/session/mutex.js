'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { fault } = require('./fault');

// SQLite contains no credentials. Its OS-backed write lock survives async work,
// serializes windows/processes, and is released by the OS if an owner crashes.
// Busy acquisition polls asynchronously instead of blocking a window's event loop.
class SessionMutex {
  constructor(directory, { timeoutMs=10000, pause=ms=>new Promise(r=>setTimeout(r,ms)) }={}) { this.directory=directory;this.timeoutMs=timeoutMs;this.pause=pause; }
  async run(work,{signal}={}) {
    if(signal?.aborted)throw fault('CANCELED');
    let DatabaseSync;try{({DatabaseSync}=require('node:sqlite'));}catch{throw fault('STORAGE_UNAVAILABLE');}
    await fs.mkdir(this.directory,{recursive:true,mode:0o700});
    const stat=await fs.lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw fault('STORAGE_UNAVAILABLE');
    const filename=path.join(this.directory,'session-access.sqlite');let database;
    try{const existing=await fs.lstat(filename);if(!existing.isFile()||existing.isSymbolicLink())throw fault('STORAGE_UNAVAILABLE');}catch(e){if(e.code!=='ENOENT')throw fault('STORAGE_UNAVAILABLE');}
    const deadline=Date.now()+this.timeoutMs;
    while(!database){
      if(signal?.aborted)throw fault('CANCELED');
      let candidate;
      try{
        candidate=new DatabaseSync(filename,{timeout:0});candidate.exec('PRAGMA busy_timeout=0');
        candidate.exec('CREATE TABLE IF NOT EXISTS session_mutex (id INTEGER PRIMARY KEY CHECK(id=1))');
        candidate.exec('BEGIN IMMEDIATE');database=candidate;
      }catch(error){
        try{candidate?.close();}catch{}
        if(!/locked|busy/i.test(String(error.message)))throw fault('STORAGE_UNAVAILABLE');
        if(Date.now()>=deadline)throw fault('STORAGE_BUSY');await this.pause(15);
      }
    }
    try { await fs.chmod(filename,0o600);if(signal?.aborted)throw fault('CANCELED');return await work(); }
    finally { try{database.exec('ROLLBACK');}finally{database.close();} }
  }
}
module.exports={SessionMutex};
