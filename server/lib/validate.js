// Input validation helpers shared across routes.
//
// Throws ValidationError (HTTP 400) on bad input so route handlers can keep a
// single catch block. Messages are in Swedish to match the rest of the app.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

// Swish caps a single private payment at 150 000 SEK. Contribution and
// suggested amounts feed the Swish deep link, so they may not exceed this.
export const MAX_PAYMENT = 150000;

// A campaign *goal* is not a payment — leave plenty of head room for the
// planned larger-campaign use case, while still guarding against overflow/abuse.
export const MAX_TARGET = 100_000_000;

export const LIMITS = {
  title: 120,
  description: 2000,
  name: 100,
  swishNumber: 20,
  updateTitle: 120,
  updateBody: 5000,
};

export const CONTRIBUTION_STATUSES = ['verified', 'unverified'];

export function isValidStatus(value) {
  return CONTRIBUTION_STATUSES.includes(value);
}

// Required, trimmed string with a max length.
export function requireText(value, field, max) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ValidationError(`${field} krävs`);
  }
  const text = String(value).trim();
  if (text.length > max) {
    throw new ValidationError(`${field} är för långt (max ${max} tecken)`);
  }
  return text;
}

// Optional, trimmed string with a max length. Returns null when absent.
export function optionalText(value, field, max) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const text = String(value).trim();
  if (text.length > max) {
    throw new ValidationError(`${field} är för långt (max ${max} tecken)`);
  }
  return text;
}

// Optional positive monetary amount, rounded to öre. Returns null when absent.
export function optionalAmount(value, { field = 'Belopp', max = MAX_PAYMENT } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`${field} måste vara ett giltigt tal`);
  }
  if (num <= 0) {
    throw new ValidationError(`${field} måste vara större än 0`);
  }
  if (num > max) {
    throw new ValidationError(`${field} får vara högst ${max.toLocaleString('sv-SE')} kr`);
  }
  return Math.round(num * 100) / 100;
}
