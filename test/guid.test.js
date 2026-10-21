import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceGuid, isGuid } from '../src/guid.js';

test('uses the UUID the scanner announces, normalised', () => {
  const guid = deviceGuid({ txt: { UUID: 'urn:uuid:E3248000-80CE-11DB-8000-B422009899D8' }, host: 'a.local', name: 'x' });
  assert.equal(guid, 'e3248000-80ce-11db-8000-b422009899d8');
});

test('derives a valid UUID when the scanner announces none', () => {
  const guid = deviceGuid({ txt: { ty: 'Example 1' }, host: 'EXAMPLE1.local', name: 'Example 1' });
  assert.ok(isGuid(guid));
  assert.equal(guid[14], '5'); // name-based UUID version
});

test('the derived GUID is stable: same scanner, same GUID', () => {
  const a = deviceGuid({ txt: { ty: 'Example 1' }, host: 'EXAMPLE1.local', name: 'Example 1' });
  // Different service name (mDNS conflict suffix), case, and extra TXT keys do not change it.
  const b = deviceGuid({ txt: { ty: 'Example 1', is: 'adf' }, host: 'example1.LOCAL', name: 'Example 1 (2)' });
  assert.equal(a, b);
});

test('different scanners get different GUIDs', () => {
  const a = deviceGuid({ txt: { ty: 'Example 1' }, host: 'one.local', name: 'one' });
  const b = deviceGuid({ txt: { ty: 'Example 1' }, host: 'two.local', name: 'two' });
  assert.notEqual(a, b);
});

test('ignores an announced UUID that is not a UUID', () => {
  const guid = deviceGuid({ txt: { UUID: 'not-a-uuid', ty: 'Example 1' }, host: 'one.local', name: 'one' });
  assert.ok(isGuid(guid));
  assert.notEqual(guid, 'not-a-uuid');
});
