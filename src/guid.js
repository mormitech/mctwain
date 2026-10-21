import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Stable id of a scanner. Uses the UUID the scanner announces (most eSCL scanners do). Otherwise a UUID is
// derived from data that doesn't change between searches: the mDNS host name and the model. No timestamp, no
// IP address (DHCP can change it) and no service name (mDNS appends " (2)" on name conflicts), so the same
// scanner always gets the same GUID when it is discovered again.
export function deviceGuid({ txt, host, name }) {
  const announced = String(txt?.UUID ?? txt?.uuid ?? '')
    .replace(/^urn:uuid:/i, '')
    .trim()
    .toLowerCase();
  if (UUID.test(announced)) return announced;

  const hash = createHash('sha1')
    .update(`mctwain|${String(host ?? name ?? '').toLowerCase()}|${txt?.ty ?? ''}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5 (name-based)
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export const isGuid = (value) => UUID.test(String(value));
