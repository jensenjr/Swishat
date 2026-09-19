// Swish number + deep link helpers, shared by the server (validation) and the
// frontend (deep link building).
//
// Background: the Swish app rejects `swish://payment?data=…` links whose
// `payee.value` is not a valid Swish *alias*. An alias is either a Swish Handel
// number (10 digits starting with 123) or a Swedish mobile number written with
// the country code and no leading zero (46XXXXXXXXX). A number entered the way
// people normally write it — `072-215 06 81` or `0722150681` — is not an alias,
// and the app answers with "Felaktig länk – länken som användes för att öppna
// appen har ett felaktigt format". Everything that builds a deep link must send
// the number through `normalizeSwishNumber` first.

// Characters Swish accepts in the payment message. Anything else is dropped
// rather than passed on, so a stray character can't break the whole link.
const MESSAGE_ALLOWED = /[^0-9A-Za-zÅÄÖåäö \-:;.,?!()"]/g;
const MESSAGE_MAX = 50;

// Returns the number in Swish alias form, or null when it isn't one.
export function normalizeSwishNumber(raw) {
  if (raw === undefined || raw === null) return null;

  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2); // 0046… → 46…

  // Swish Handel number — already an alias.
  if (/^123\d{7}$/.test(digits)) return digits;

  // Mobile number with country code, e.g. 46722150681.
  if (/^46[1-9]\d{7,8}$/.test(digits)) return digits;

  // Mobile number as normally written, e.g. 0722150681.
  if (/^0[1-9]\d{7,8}$/.test(digits)) return `46${digits.slice(1)}`;

  return null;
}

export function isValidSwishNumber(raw) {
  return normalizeSwishNumber(raw) !== null;
}

// Human-readable form of a stored number: +46 72 215 06 81 / 123 456 78 90.
export function formatSwishNumber(raw) {
  const alias = normalizeSwishNumber(raw);
  if (!alias) return String(raw ?? '').trim();
  if (alias.startsWith('123')) {
    return alias.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4');
  }
  const national = `0${alias.slice(2)}`;
  return national.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4');
}

export function sanitizeSwishMessage(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw).replace(MESSAGE_ALLOWED, '').trim().slice(0, MESSAGE_MAX);
}

// Builds the `swish://payment?data=…` deep link. Returns "" when the number
// isn't a usable Swish alias, so callers can fall back to manual instructions
// instead of handing the payer a link the app will reject.
export function buildSwishUrl({ swishNumber, amount, message } = {}) {
  const payee = normalizeSwishNumber(swishNumber);
  if (!payee) return '';

  const data = {
    version: 1,
    payee: { value: payee, editable: false },
  };

  // An amount of 0 is not a payment — omit the key entirely so the payer can
  // enter one themselves rather than having the app reject the link.
  const value = Number(amount);
  if (Number.isFinite(value) && value > 0) {
    data.amount = { value: Math.round(value * 100) / 100, editable: false };
  }

  const text = sanitizeSwishMessage(message);
  if (text) data.message = { value: text, editable: false };

  return `swish://payment?data=${encodeURIComponent(JSON.stringify(data))}`;
}
