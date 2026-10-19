import { describe, expect, it } from 'vitest';

import { apply, BENCH, kg, logCmd, ms, setsFor, startFixture, values } from '@fizz/domain/testing';

import { finishModel } from '../src/workout/finish';

describe('finish sheet model', () => {
  const { state } = startFixture();
  const logged = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 100));

  it('nothing logged offers Discard', () => {
    expect(finishModel(state, ms(60))).toMatchObject({ nothingLogged: true, done: 0, total: 8, willSkip: 8, defaultEndMs: ms(60), minEndMs: ms(0) });
  });

  it('defaults to now, or to last set + 3 min after a forgotten Finish', () => {
    expect(finishModel(logged, ms(600))).toMatchObject({ forgotten: false, defaultEndMs: ms(600), minEndMs: ms(100), maxEndMs: ms(600), done: 1, willSkip: 7 });
    expect(finishModel(logged, ms(100 + 21 * 60))).toMatchObject({ forgotten: true, defaultEndMs: ms(100 + 180) });
  });
});
