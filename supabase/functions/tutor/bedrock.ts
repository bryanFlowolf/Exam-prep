// Minimal Amazon Bedrock client for the Converse API, with no dependencies (Deno and Node 22).
// Auth: a Bedrock API key (bearer token) or IAM credentials signed with AWS Signature V4.

export type BedrockConfig = {
  region: string;
  modelId: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Override for tests; defaults to https://bedrock-runtime.<region>.amazonaws.com */
  endpoint?: string;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** RFC 3986 encoding as AWS expects (keeps A-Z a-z 0-9 - _ . ~). */
export function awsEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Signs a request with AWS Signature Version 4 and returns the headers to send.
 * `path` must already be URI-encoded as it will be sent; for non-S3 services the
 * canonical URI encodes each segment once more.
 */
export async function signV4(opts: {
  method: string; host: string; path: string; query?: string; headers: Record<string, string>; body: string;
  region: string; service: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string; now?: Date;
}): Promise<Record<string, string>> {
  const now = opts.now || new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...opts.headers, host: opts.host, 'x-amz-date': amzDate };
  if (opts.sessionToken) headers['x-amz-security-token'] = opts.sessionToken;
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalUri = opts.service === 's3' ? opts.path : opts.path.split('/').map((seg) => awsEncode(seg)).join('/');
  const canonicalRequest = [opts.method, canonicalUri, opts.query || '', canonicalHeaders, signedHeaders, await sha256Hex(opts.body)].join('\n');
  const scope = `${day}/${opts.region}/${opts.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  let key = await hmac(enc.encode('AWS4' + opts.secretAccessKey) as Uint8Array<ArrayBuffer>, day);
  key = await hmac(key, opts.region);
  key = await hmac(key, opts.service);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, toSign));
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function bedrockConfigured(c: Partial<BedrockConfig>): boolean {
  return Boolean(c.region && c.modelId && (c.apiKey || (c.accessKeyId && c.secretAccessKey)));
}

/** Calls the Converse API and returns the assistant's text. */
export async function converse(c: BedrockConfig, system: string, messages: ChatMessage[], maxTokens = 800): Promise<string> {
  const base = c.endpoint || `https://bedrock-runtime.${c.region}.amazonaws.com`;
  const url = new URL(base);
  const path = `/model/${awsEncode(c.modelId)}/converse`;
  const body = JSON.stringify({
    system: [{ text: system }],
    messages: messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
    inferenceConfig: { maxTokens, temperature: 0.3 },
  });
  let headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (c.apiKey) headers.authorization = `Bearer ${c.apiKey}`;
  else {
    headers = await signV4({
      method: 'POST', host: url.host, path, headers, body, region: c.region, service: 'bedrock',
      accessKeyId: c.accessKeyId!, secretAccessKey: c.secretAccessKey!, sessionToken: c.sessionToken,
    });
    delete headers.host;
  }
  const res = await fetch(base.replace(/\/$/, '') + path, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bedrock ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  const parts: { text?: string }[] = json?.output?.message?.content || [];
  return parts.map((p) => p.text || '').join('').trim();
}
