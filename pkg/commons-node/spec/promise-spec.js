'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import {
  asyncFind,
  denodeify,
  serializeAsyncCall,
  asyncLimit,
  asyncFilter,
  asyncObjFilter,
  asyncSome,
  lastly,
  retryLimit,
  RequestSerializer,
} from '../promise';
import {expectAsyncFailure} from '../../nuclide-test-helpers';
import invariant from 'assert';

describe('promises::asyncFind()', () => {

  it('Empty list of items should resolve to null.', () => {
    let isResolved = false;
    let observedResult;
    let isRejected = false;
    let observedError;

    const args = [];
    const test = value => { throw new Error('Should not be called.'); };

    runs(() => {
      asyncFind(args, test)
          .then(result => {
            observedResult = result;
            isResolved = true;
          })
          .catch(error => {
            observedError = error;
            isRejected = true;
          });
    });

    waitsFor(() => isResolved || isRejected);

    runs(() => {
      expect(isResolved).toBe(true);
      expect(observedResult).toBe(null);
      expect(isRejected).toBe(false);
      expect(observedError).toBe(undefined);
    });
  });

  it('Last item in list resolves.', () => {
    let isResolved = false;
    let observedResult;
    let isRejected = false;
    let observedError;

    const args = ['foo', 'bar', 'baz'];
    const test = value => {
      if (value === 'foo') {
        return null;
      } else if (value === 'bar') {
        return Promise.resolve(null);
      } else {
        return Promise.resolve('win');
      }
    };

    runs(() => {
      asyncFind(args, test)
          .then(result => {
            observedResult = result;
            isResolved = true;
          })
          .catch(error => {
            observedError = error;
            isRejected = true;
          });
    });

    waitsFor(() => isResolved || isRejected);

    runs(() => {
      expect(isResolved).toBe(true);
      expect(observedResult).toBe('win');
      expect(isRejected).toBe(false);
      expect(observedError).toBe(undefined);
    });
  });
});

describe('promises::denodeify()', () => {
  /**
   * Vararg function that assumes that all elements except the last are
   * numbers, as the last argument is a callback function. All of the
   * other arguments are multiplied together. If the result is not NaN,
   * then the callback is called with the product. Otherwise, the callback
   * is called with an error.
   *
   * This function exhibits some of the quirky behavior of Node APIs that
   * accept a variable number of arguments in the middle of the parameter list
   * rather than at the end. The type signature of this function cannot be
   * expressed in Flow.
   */
  function asyncProduct(): void {
    const factors = Array.prototype.slice.call(arguments, 0, arguments.length - 1);
    const product = factors.reduce((previousValue, currentValue) => {
      return previousValue * currentValue;
    }, 1);

    const callback = arguments[arguments.length - 1];
    if (isNaN(product)) {
      callback(new Error('product was NaN'));
    } else {
      callback(null, product);
    }
  }

  it('resolves Promise when callback succeeds', () => {
    const denodeifiedAsyncProduct = denodeify(asyncProduct);
    waitsForPromise(async () => {
      const trivialProduct = await denodeifiedAsyncProduct();
      expect(trivialProduct).toBe(1);

      const product = await denodeifiedAsyncProduct(1, 2, 3, 4, 5);
      expect(product).toBe(120);
    });
  });

  it('rejects Promise when callback fails', () => {
    const denodeifiedAsyncProduct = denodeify(asyncProduct);
    waitsForPromise(async () => {
      await expectAsyncFailure(denodeifiedAsyncProduct('a', 'b'), (error: Error) => {
        expect(error.message).toBe('product was NaN');
      });
    });
  });

  function checksReceiver(expectedReceiver, callback) {
    if (this === expectedReceiver) {
      callback(null, 'winner');
    } else {
      callback(new Error('unexpected receiver'));
    }
  }

  it('result of denodeify propagates receiver as expected', () => {
    const denodeifiedChecksReceiver = denodeify(checksReceiver);

    waitsForPromise(async () => {
      const receiver = {denodeifiedChecksReceiver};
      const result = await receiver.denodeifiedChecksReceiver(receiver);
      expect(result).toBe('winner');
    });

    waitsForPromise(async () => {
      const receiver = {denodeifiedChecksReceiver};
      await expectAsyncFailure(receiver.denodeifiedChecksReceiver(null), (error: Error) => {
        expect(error.message).toBe('unexpected receiver');
      });
    });
  });
});

describe('promises::serializeAsyncCall()', () => {

  it('Returns the same result when called after scheduled', () => {
    let i = 0;
    const asyncFunSpy = jasmine.createSpy('async');
    const oneAsyncCallAtATime = serializeAsyncCall(() => {
      i++;
      const resultPromise = waitPromise(10, i);
      asyncFunSpy();
      return resultPromise;
    });
    // Start an async, and resolve to 1 in 10 ms.
    const result1Promise = oneAsyncCallAtATime();
    // Schedule the next async, and resolve to 2 in 20 ms.
    const result2Promise = oneAsyncCallAtATime();
    // Reuse scheduled promise and resolve to 2 in 20 ms.
    const result3Promise = oneAsyncCallAtATime();

    window.advanceClock(11);
    // Wait for the promise to call the next chain
    // That isn't synchrnously guranteed because it happens on `process.nextTick`.
    waitsFor(() => asyncFunSpy.callCount === 2);
    waitsForPromise(async () => {
      window.advanceClock(11);
      const results = await Promise.all([
        result1Promise, result2Promise, result3Promise,
      ]);
      expect(results).toEqual([1, 2, 2]);
    });
  });

  it('Calls and returns (even if errors) the same number of times if serially called', () => {
    waitsForPromise(async () => {
      let i = 0;
      const oneAsyncCallAtATime = serializeAsyncCall(() => {
        i++;
        if (i === 4) {
          return Promise.reject('ERROR');
        }
        return waitPromise(10, i);
      });
      const result1Promise = oneAsyncCallAtATime();
      window.advanceClock(11);
      const result1 = await result1Promise;

      const result2Promise = oneAsyncCallAtATime();
      window.advanceClock(11);
      const result2 = await result2Promise;

      const result3Promise = oneAsyncCallAtATime();
      window.advanceClock(11);
      const result3 = await result3Promise;

      const errorPromoise = oneAsyncCallAtATime();
      window.advanceClock(11);
      await expectAsyncFailure(errorPromoise, error => {
        expect(error).toBe('ERROR');
      });

      const result5Promise = oneAsyncCallAtATime();
      window.advanceClock(11);
      const result5 = await result5Promise;
      expect([result1, result2, result3, result5]).toEqual([1, 2, 3, 5]);
    });
  });
});

describe('promises::asyncLimit()', () => {
  beforeEach(() => {
    jasmine.useRealClock();
  });

  it('runs in series if limit is 1', () => {
    waitsForPromise(async () => {
      const {result, parallelismHistory} = await captureParallelismHistory(
          asyncLimit,
        [
            [1, 2, 3],
          1,
          item => waitPromise(10, item + 1),
        ],
      );
      expect(parallelismHistory).toEqual([1, 1, 1]);
      expect(result).toEqual([2, 3, 4]);
    });
  });

  it('runs with the specified limit, until finishing', () => {
    waitsForPromise(async () => {
      const {result, parallelismHistory} = await captureParallelismHistory(
          asyncLimit,
        [
            [1, 2, 3, 4, 5, 6, 7, 8, 9],
          3,
          item => waitPromise(10 + item, item - 1),
        ],
      );
      expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(parallelismHistory).toEqual([1, 2, 3, 3, 3, 3, 3, 3, 3]);
    });
  });

  it('works when the limit is bigger than the array length', () => {
    waitsForPromise(async () => {
      const result = await asyncLimit([1, 2, 3], 10, item => waitPromise(10, item * 2));
      expect(result).toEqual([2, 4, 6]);
    });
  });

  it('a rejected promise rejects the whole call with the error', () => {
    waitsForPromise(async () => {
      await expectAsyncFailure(asyncLimit([1], 1, async item => {
        throw new Error('rejected iterator promise');
      }), (error: Error) => {
        expect(error.message).toBe('rejected iterator promise');
      });
    });
  });

  it('works when the array is empty', () => {
    waitsForPromise(async () => {
      const result = await asyncLimit([], 1, () => Promise.resolve());
      expect(result).toEqual([]);
    });
  });
});

describe('promises::asyncFilter()', () => {
  beforeEach(() => {
    jasmine.useRealClock();
  });

  // eslint-disable-next-line max-len
  it('filters an array with an async iterator and maximum parallelization when no limit is specified', () => {
    waitsForPromise(async () => {
      const {result: filtered, parallelismHistory} = await captureParallelismHistory(
          asyncFilter,
        [
            [1, 2, 3, 4, 5],
          item => waitPromise(10 + item, item > 2),
        ],
      );
      expect(filtered).toEqual([3, 4, 5]);
      expect(parallelismHistory).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it('filters an array with a limit on parallelization', () => {
    waitsForPromise(async () => {
      const {result: filtered, parallelismHistory} = await captureParallelismHistory(
          asyncFilter,
        [
            [1, 2, 3, 4, 5],
          item => waitPromise(10 + item, item > 2),
          3,
        ],
      );
      expect(filtered).toEqual([3, 4, 5]);
      // Increasing promise resolve time will gurantee maximum parallelization.
      expect(parallelismHistory).toEqual([1, 2, 3, 3, 3]);
    });
  });
});

describe('promises::asyncObjFilter()', () => {
  beforeEach(() => {
    jasmine.useRealClock();
  });

  // eslint-disable-next-line max-len
  it('filters an object with an async iterator and maximum parallelization when no limit is specified', () => {
    waitsForPromise(async () => {
      const {result: filtered, parallelismHistory} = await captureParallelismHistory(
          asyncObjFilter,
        [
            {a: 1, b: 2, c: 3, d: 4, e: 5},
          (value, key) => waitPromise(5 + value, value > 2),
        ],
      );
      expect(filtered).toEqual({c: 3, d: 4, e: 5});
      expect(parallelismHistory).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it('filters an array with a limit on parallelization', () => {
    waitsForPromise(async () => {
      const {result: filtered, parallelismHistory} = await captureParallelismHistory(
          asyncObjFilter,
        [
            {a: 1, b: 2, c: 3, d: 4, e: 5},
          (value, key) => waitPromise(5 + value, value > 2),
          3,
        ],
      );
      expect(filtered).toEqual({c: 3, d: 4, e: 5});
      // Increasing promise resolve time will gurantee maximum parallelization.
      expect(parallelismHistory).toEqual([1, 2, 3, 3, 3]);
    });
  });
});

describe('promises::asyncSome()', () => {
  beforeEach(() => {
    jasmine.useRealClock();
  });

  // eslint-disable-next-line max-len
  it('some an array with an async iterator and maximum parallelization when no limit is specified', () => {
    waitsForPromise(async () => {
      const {result, parallelismHistory} = await captureParallelismHistory(
          asyncSome,
        [
            [1, 2, 3, 4, 5],
          item => waitPromise(10, item === 6),
        ],
      );
      expect(result).toEqual(false);
      expect(parallelismHistory).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it('some an array with a limit on parallelization', () => {
    waitsForPromise(async () => {
      const {result, parallelismHistory} = await captureParallelismHistory(
          asyncSome,
        [
            [1, 2, 3, 4, 5],
          item => waitPromise(10 + item, item === 5),
          3,
        ],
      );
      expect(result).toEqual(true);
      expect(parallelismHistory).toEqual([1, 2, 3, 3, 3]);
    });
  });
});

describe('promises::lastly', () => {
  it('executes after a resolved promise', () => {
    waitsForPromise(async () => {
      const spy = jasmine.createSpy('spy');
      const result = await lastly(Promise.resolve(1), spy);
      expect(result).toBe(1);
      expect(spy).toHaveBeenCalled();
    });
  });

  it('executes after a rejected promise', () => {
    waitsForPromise(async () => {
      const spy = jasmine.createSpy('spy');
      await expectAsyncFailure(lastly(Promise.reject(2), spy), err => {
        expect(err).toBe(2);
      });
      expect(spy).toHaveBeenCalled();
    });
  });

  it('works for async functions', () => {
    waitsForPromise(async () => {
      const spy = jasmine.createSpy('spy');
      const result = await lastly(Promise.resolve(1), async () => {
        spy();
      });
      expect(result).toBe(1);
      expect(spy).toHaveBeenCalled();
    });
  });
});

describe('promises::retryLimit()', () => {
  beforeEach(() => {
    jasmine.useRealClock();
  });

  it('retries and fails 2 times before resolving to an acceptable result where limit = 5', () => {
    waitsForPromise(async () => {
      let succeedAfter = 2;
      let calls = 0;
      let validationCalls = 0;
      const retrialsResult = await retryLimit(() => {
        return new Promise((resolve, reject) => {
          calls++;
          if (succeedAfter-- === 0) {
            resolve('RESULT');
          } else {
            reject('ERROR');
          }
        });
      }, result => {
        validationCalls++;
        return result === 'RESULT';
      }, 5);
      expect(calls).toBe(3);
      expect(validationCalls).toBe(1);
      expect(retrialsResult).toBe('RESULT');
    });
  });

  it('retries and fails consistently', () => {
    waitsForPromise(async () => {
      let calls = 0;
      let validationCalls = 0;
      const failRetriesPromise = retryLimit(
        () => {
          calls++;
          return Promise.reject('ERROR');
        },
        result => {
          validationCalls++;
          return result != null;
        },
        2,
      );
      await expectAsyncFailure(failRetriesPromise, error => {
        expect(error).toBe('ERROR');
      });
      expect(calls).toBe(2);
      expect(validationCalls).toBe(0);
    });
  });

  it('accepts a null response', () => {
    waitsForPromise(async () => {
      let succeedAfter = 2;
      let calls = 0;
      let validationCalls = 0;
      const retryResult = await retryLimit(
        () => {
          calls++;
          if (succeedAfter-- === 0) {
            return Promise.resolve(null);
          } else {
            return Promise.resolve('NOT_GOOD');
          }
        },
        result => {
          validationCalls++;
          return result == null;
        },
        5,
      );
      expect(retryResult).toBe(null);
      expect(calls).toBe(3);
      expect(validationCalls).toBe(3);
    });
  });

  it('no valid response is ever got', () => {
    waitsForPromise(async () => {
      const nonValidRetriesPromise = retryLimit(
        () => {
          return Promise.resolve('A');
        },
        result => {
          return result === 'B';
        },
        2,
      );
      await expectAsyncFailure(nonValidRetriesPromise, error => {
        expect(error.message).toBe('No valid response found!');
      });
    });
  });
});

describe('promises::RequestSerializer()', () => {
  let requestSerializer: RequestSerializer<any> = (null: any);

  beforeEach(() => {
    jasmine.useRealClock();
    requestSerializer = new RequestSerializer();
  });

  it('gets outdated result for old promises resolving after newer calls', () => {
    waitsForPromise(async () => {
      const oldPromise = requestSerializer.run(waitPromise(10, 'OLD'));
      const newPromise = requestSerializer.run(waitPromise(5, 'NEW'));
      const {status: oldStatus} = await oldPromise;
      expect(oldStatus).toBe('outdated');
      const newResult = await newPromise;
      expect(newResult.status).toBe('success');
      invariant(newResult.result);
      expect(newResult.result).toBe('NEW');
    });
  });

  it('waitForLatestResult: waits for the latest result', () => {
    waitsForPromise(async () => {
      requestSerializer.run(waitPromise(5, 'OLD'));
      requestSerializer.run(waitPromise(10, 'NEW'));
      const latestResult = await requestSerializer.waitForLatestResult();
      expect(latestResult).toBe('NEW');
    });
  });

  it('waitForLatestResult: waits even if the first run did not kick off', () => {
    waitsForPromise(async () => {
      const latestResultPromise = requestSerializer.waitForLatestResult();
      requestSerializer.run(waitPromise(10, 'RESULT'));
      const latestResult = await latestResultPromise;
      expect(latestResult).toBe('RESULT');
    });
  });

  it('waitForLatestResult: does not wait for the first, if the second resolves faster', () => {
    waitsForPromise(async () => {
      requestSerializer.run(waitPromise(1000000, 'OLD')); // This will never resolve.
      requestSerializer.run(waitPromise(10, 'NEW'));
      const latestResult = await requestSerializer.waitForLatestResult();
      expect(latestResult).toBe('NEW');
    });
  });
});


async function captureParallelismHistory(
  asyncFunction: (...args: Array<any>) => Promise<mixed>,
  args: Array<mixed>,
): Promise<{result: mixed, parallelismHistory: Array<number>}> {
  const parallelismHistory = [];
  let parralelism = 0;
  const result = await asyncFunction.apply(null, args.map(arg => {
    if (typeof arg !== 'function') {
      return arg;
    }
    const func = arg;
    return async item => {
      ++parralelism;
      parallelismHistory.push(parralelism);
      const value = await func(item);
      --parralelism;
      return value;
    };
  }));
  return {result, parallelismHistory};
}

function waitPromise(timeoutMs: number, value: any): Promise<any> {
  return new Promise((resolve, reject) => {
    setTimeout(() => resolve(value), timeoutMs);
  });
}
