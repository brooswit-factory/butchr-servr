import {mkdirSync,cpSync,copyFileSync,renameSync} from "node:fs";
import {join} from "node:path";
const root=join(import.meta.dir,"..");
const build=Bun.spawn([process.execPath,join(root,"node_modules/vite/bin/vite.js"),"build"],{cwd:root,stdout:"inherit",stderr:"inherit"});
if(await build.exited!==0)process.exit(1);
const next=join(root,"web-dist-next"),live=join(root,"web-dist");
mkdirSync(join(live,"web"),{recursive:true});
// Keep prior hashed assets so already-open tabs keep their lazy chunks.
cpSync(join(next,"assets"),join(live,"assets"),{recursive:true});
copyFileSync(join(next,"THIRD_PARTY_NOTICES.txt"),join(live,"THIRD_PARTY_NOTICES.txt"));
copyFileSync(join(next,"web/control-panel.html"),join(live,"web/control-panel.html.next"));
renameSync(join(live,"web/control-panel.html.next"),join(live,"web/control-panel.html"));
console.log("Control panel built; prior assets retained.");
