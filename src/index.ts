import { join } from "node:path";
import { createStore } from "./store.js";
import { serve } from "./server.js";
const store=createStore(process.env.BUTCHR_SERVR_DB??join(import.meta.dir,"../runtime/control.sqlite"));
const server=serve(store,Number(process.env.BUTCHR_SERVR_PORT??7731),undefined,{publicOrigin:process.env.BUTCHR_SERVR_PUBLIC_ORIGIN});
console.log(`butchr-servr: http://127.0.0.1:${server.port} (loopback only)`);
async function stop(){await server.stop(true);await store.close();process.exit(0);}process.on("SIGTERM",stop);process.on("SIGINT",stop);
