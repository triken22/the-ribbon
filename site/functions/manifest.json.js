// /manifest.json -> R2 key manifest.json (what js/data.js requests). A missing object falls through to the static 404 = the empty state.
import { serve } from './_lib/serve.js';
export const onRequest = (context) => serve(context);
