import { describe, expect, it } from 'vitest';
import { parseJoinLink } from '../src/app/crew';

describe('reading a join link', () => {
  it('splits a crew from its secret', () => {
    expect(parseJoinLink('c1-s1')).toEqual({ crewId: 'c1', secret: 's1' });
  });

  it('splits on the first hyphen, so a secret may contain more', () => {
    // A greedy split read this as crew "c1-s1" with secret "rotated".
    expect(parseJoinLink('c1-s1-rotated')).toEqual({ crewId: 'c1', secret: 's1-rotated' });
  });

  it('reads the hex ids the worker really issues', () => {
    const id = '8f4fb4a8037d4a66ae804aa9e9e9850f';
    const secret = 'c93709dd18060cb1d53b8d08ff15a5df';
    expect(parseJoinLink(`${id}-${secret}`)).toEqual({ crewId: id, secret });
  });

  it('ignores surrounding space', () => {
    expect(parseJoinLink('  c1-s1  ')).toEqual({ crewId: 'c1', secret: 's1' });
  });

  it('refuses something that is not a link', () => {
    expect(parseJoinLink('')).toBeNull();
    expect(parseJoinLink('nohyphen')).toBeNull();
    expect(parseJoinLink('-onlysecret')).toBeNull();
  });
});
