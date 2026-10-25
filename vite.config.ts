import {sharedEditorForServer} from "./scripts/shared-editor.js";
import {defineConfig,type Plugin} from "vite";
import react from "@vitejs/plugin-react";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {collectThirdPartyNoticesForBundle} from "./vendor/butchr/scripts/build/web-notices.js";
function notices():Plugin{const ids:string[]=[];return {name:'third-party-notices',generateBundle(_options,bundle){for(const entry of Object.values(bundle))if(entry.type==='chunk')ids.push(...Object.keys(entry.modules));},closeBundle(){writeFileSync(join(import.meta.dirname,'web-dist-next','THIRD_PARTY_NOTICES.txt'),collectThirdPartyNoticesForBundle(import.meta.dirname,ids));}};}
export default defineConfig({root:'.',plugins:[{name:"server-editor-context",enforce:"pre",transform(code,id){if(id.includes("/vendor/butchr/dashboard-app/"))return sharedEditorForServer(code,id);}},react(),notices()],build:{outDir:'web-dist-next',emptyOutDir:true,rollupOptions:{input:'web/control-panel.html'}},resolve:{dedupe:['react','react-dom','react-router']}});
