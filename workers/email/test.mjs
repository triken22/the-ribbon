// Plain-node tests for the email Worker's pure helpers (no network, no bindings). Run: node workers/email/test.mjs
import assert from 'node:assert/strict';
import { parseSubscribe, transportFor, kindleFile } from './src/index.js';

assert.deepEqual(parseSubscribe({ email: ' Me@Example.COM ', kindle: 'Reader_2841@kindle.com', variant: 'b' }),
  { email: 'me@example.com', kindle: 'reader_2841@kindle.com', variant: 'b' });
assert.equal(parseSubscribe({ email: 'me@example.com', kindle: 'reader@gmail.com' }), null, 'kindle must be @kindle.com');
assert.equal(parseSubscribe({ email: 'me@example.com', kindle: 'a b@kindle.com' }), null);
assert.equal(parseSubscribe({ email: 'not-an-email', kindle: 'r@kindle.com' }), null);
assert.equal(parseSubscribe({ email: 'a@b.co\r\nBcc: x@y.z', kindle: 'r@kindle.com' }), null, 'no header injection');
assert.equal(parseSubscribe(null), null);
assert.equal(parseSubscribe({ email: 'me@example.com', kindle: 'r@kindle.com', variant: '<script>' }).variant, null);

const MAX = 3600000;
assert.equal(transportFor(1_200_000, MAX), 'cloudflare');
assert.equal(transportFor(MAX, MAX), 'cloudflare');
assert.equal(transportFor(10_460_000, MAX), 'resend', 'Issue 3 greyscale PDF (9.98 MiB) needs the fallback');
assert.equal(transportFor(undefined, MAX), 'resend');

assert.equal(kindleFile({ files: { pdf_color: 'issue-003-color.pdf', pdf_grayscale: 'issue-003-gray.pdf' } }), 'issue-003-gray.pdf');
assert.equal(kindleFile({ files: { pdf_color: 'issue-003-color.pdf' } }), 'issue-003-color.pdf');
assert.equal(kindleFile({ files: { pdf_kindle: 'issue-003-kindle.pdf', pdf_grayscale: 'issue-003-gray.pdf' } }), 'issue-003-kindle.pdf');
assert.equal(kindleFile({ files: { pdf_grayscale: '../secret.pdf' } }), null);
assert.equal(kindleFile({}), null);
console.log('email worker helpers ok');
