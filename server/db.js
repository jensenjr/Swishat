import { neon } from '@neondatabase/serverless';

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(process.env.DATABASE_URL);
}

// Lazy singleton — initialised on first API request, not at startup.
// This keeps the server alive (and /health working) even before DATABASE_URL is set.
let _sql;
const sql = new Proxy({}, {
  get(_target, prop) {
    if (!_sql) _sql = getSql();
    const val = _sql[prop];
    return typeof val === 'function' ? val.bind(_sql) : val;
  },
  apply(_target, _thisArg, args) {
    if (!_sql) _sql = getSql();
    return _sql(...args);
  },
});

// neon() returns a tagged-template function, not a plain object,
// so we need to wrap it as a callable proxy.
const sqlFn = new Proxy(function () {}, {
  apply(_target, _thisArg, args) {
    if (!_sql) _sql = getSql();
    return _sql(...args);
  },
  get(_target, prop) {
    if (!_sql) _sql = getSql();
    const val = _sql[prop];
    return typeof val === 'function' ? val.bind(_sql) : val;
  },
});

export default sqlFn;
