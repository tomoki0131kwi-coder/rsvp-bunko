import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURES = resolve(__dirname, 'fixtures');

export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, name)));
}

export function fixtureText(name: string): string {
  return new TextDecoder().decode(fixture(name));
}
