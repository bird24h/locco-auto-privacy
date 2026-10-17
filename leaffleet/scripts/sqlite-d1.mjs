import {DatabaseSync} from 'node:sqlite';
export class SQLiteD1 {
 constructor(path=':memory:'){this.sqlite=new DatabaseSync(path);this.sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');this.failAt=null;}
 prepare(sql){const db=this;return {sql,args:[],bind(...args){return {...this,args};},async first(column){const row=db.sqlite.prepare(this.sql).get(...this.args)??null;return column&&row?row[column]:row;},async all(){return {results:db.sqlite.prepare(this.sql).all(...this.args),success:true};},async run(){const r=db.sqlite.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(r.changes)}}}};}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const results=[];for(let i=0;i<statements.length;i++){if(this.failAt===i){this.failAt=null;throw Error('Injected storage failure')}const s=statements[i],p=this.sqlite.prepare(s.sql);if(p.columns().length){results.push({success:true,results:p.all(...s.args),meta:{changes:0}})}else{const r=p.run(...s.args);results.push({success:true,results:[],meta:{changes:Number(r.changes)}})}}this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
 close(){this.sqlite.close();}
}
