#!/usr/bin/env node
/**
 * Fails if the built frontend bundle contains Supabase secret key MATERIAL.
 *
 * A plain `grep "sb_secret_|service_role"` cannot be used: src/lib/env.ts deliberately
 * contains those words in the runtime guard that rejects secret keys, so the bundle always
 * matches. This scanner looks for actual keys instead:
 *   - new-style secret keys: `sb_secret_` followed by key characters;
 *   - legacy JWT keys whose payload decodes to `"role": "service_role"`.
 *
 * Usage: node scripts/check-bundle-secrets.mjs [dist]
 *        node scripts/check-bundle-secrets.mjs --self-test
 * Matches are never printed in full; only a short redacted prefix is shown.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/g
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const TEXT_EXT = /\.(js|mjs|cjs|css|html|json|map|txt|svg|webmanifest)$/i

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (TEXT_EXT.test(name)) yield path
  }
}

function jwtRole(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8')).role ?? null
  } catch {
    return null
  }
}

const redact = (s) => `${s.slice(0, 12)}…(${s.length} chars)`

export function scan(dir) {
  const findings = []
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(SECRET_KEY)) {
      findings.push({ file, kind: 'supabase secret key', sample: redact(m[0]) })
    }
    for (const m of text.matchAll(JWT)) {
      if (jwtRole(m[0]) === 'service_role') {
        findings.push({ file, kind: 'service_role JWT', sample: redact(m[0]) })
      }
    }
  }
  return findings
}

function selfTest() {
  // Fake values are assembled at runtime so no key-shaped literal exists in the repository.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'test' })}.${'s'.repeat(43)}`
  const fakeSecret = ['sb', 'secret', 'x'.repeat(32)].join('_')
  const cases = [
    { name: 'runtime guard wording only', content: 'if(/service_role|sb_secret_/.test(k))throw Error("x")', expect: 0 },
    { name: 'publishable-style anon JWT', content: `const k="${jwt('anon')}"`, expect: 0 },
    { name: 'new-style secret key', content: `const k="${fakeSecret}"`, expect: 1 },
    { name: 'service_role JWT', content: `const k="${jwt('service_role')}"`, expect: 1 },
  ]
  let failed = 0
  for (const c of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-scan-'))
    try {
      writeFileSync(join(dir, 'index.js'), c.content)
      const got = scan(dir).length
      const ok = got === c.expect
      if (!ok) failed++
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${got} finding(s), expected ${c.expect}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  if (failed) process.exit(1)
}

const arg = process.argv[2] ?? 'dist'
if (arg === '--self-test') {
  selfTest()
} else {
  const findings = scan(arg)
  if (findings.length) {
    console.error('Secret key material found in the frontend bundle:')
    for (const f of findings) console.error(`  ${f.file}: ${f.kind} ${f.sample}`)
    process.exit(1)
  }
  console.log(`No Supabase secret key material in ${arg}.`)
}
