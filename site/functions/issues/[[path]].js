// /issues/* -> private R2 bucket via the read-only binding ISSUES. See site/docs/PUBLISH.md.
import { serve } from '../_lib/serve.js';
export const onRequest = (context) => serve(context);
