import {ContractError} from './contracts.mjs';
import {createRadioJoin} from './radio-join.mjs';

const publicErrors = new Set(['PLAYBACK_ADAPTER_TIMEOUT','STATION_AUTHENTICATION_FAILED',
  'INVALID_CIPHERTEXT_TRANSPORT','INVALID_CIPHERTEXT_FRAME','INVALID_EVIDENCE_STATE']);

/**
 * DRE-11 endpoint SDK adapter. Station authentication, key distribution and media
 * decryption belong to the pinned upstream endpoint implementation. The facade
 * handles only bounded ciphertext, linear-radio positions and lifecycle state.
 * Injected adapters are trusted application code, not remote capability claims.
 */
export function createRadioPlayback({clientType, station, transport, endpoint,
  now = Date.now, onStatus = () => {}, maxFrameBytes = 1024 * 1024, operationTimeoutMs = 10000}) {
  if (!['web','native'].includes(clientType) || typeof now !== 'function' || typeof onStatus !== 'function' ||
      typeof station?.read !== 'function' || typeof station?.verify !== 'function' ||
      typeof transport?.connect !== 'function' ||
      typeof endpoint?.writeCiphertext !== 'function' || typeof endpoint?.stop !== 'function')
    throw new ContractError('Station, ciphertext transport and endpoint adapters required');
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > 16*1024*1024 ||
      !Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > 60000)
    throw new ContractError('Invalid playback resource bounds');

  let controller, connection, closePromise, running, sealed = false;
  let state = 'stopped', errorCode = null, join = null;
  let evidenceStatus = 'unavailable';
  const transportClosures = new WeakMap();

  function closeTransport(target) {
    if (!target || typeof target.close !== 'function') return Promise.resolve();
    if (!transportClosures.has(target))
      transportClosures.set(target, Promise.resolve().then(() => target.close()));
    return transportClosures.get(target);
  }

  function status() {
    return Object.freeze({state, errorCode, join,
      route: Object.freeze({clientType, status: state === 'playing' ? 'ready' :
        ['connecting','recovering'].includes(state) ? 'recovering' : 'unavailable'}),
      evidence: Object.freeze({status: evidenceStatus}),
      seekable: false, onDemand: false, sealed});
  }

  function notify() {
    try { onStatus(status()); } catch { /* UI observers cannot alter lifecycle cleanup. */ }
  }

  function bounded(promise) {
    let timer;
    const expiry = new Promise((_, reject) => {
      timer = setTimeout(() => {
        sealed = true;
        controller?.abort();
        reject(new ContractError('PLAYBACK_ADAPTER_TIMEOUT'));
      }, operationTimeoutMs);
    });
    return Promise.race([Promise.resolve(promise), expiry]).finally(() => clearTimeout(timer));
  }

  function close() {
    if (!closePromise) {
      closePromise = Promise.all([
        closeTransport(connection),
        Promise.resolve().then(() => endpoint.stop()),
      ]);
      // A failed close cannot be treated as a cleanly stopped native/web route.
      closePromise.catch(() => { sealed = true; });
    }
    return closePromise;
  }

  async function pump() {
    let failed = false;
    try {
      const snapshot = await bounded(Promise.resolve().then(() => station.read({signal:controller.signal})));
      if (controller.signal.aborted) return;
      if (await bounded(Promise.resolve().then(() => station.verify(snapshot))) !== true)
        throw new ContractError('STATION_AUTHENTICATION_FAILED');
      if (controller.signal.aborted) return;
      // No selection/seek inputs. Recovery re-reads and verifies the current
      // authoritative station revision and wall clock instead of a saved offset.
      join = createRadioJoin({...snapshot, nowMs:now(),
        route:{clientType,status:'recovering'}, evidence:{status:'unavailable'}});
      const connecting = Promise.resolve().then(() => transport.connect({join,signal:controller.signal}));
      // Timeout fences this session permanently. A late connection is closed,
      // never exposed as playing and never allowed to deliver another frame.
      connecting.then(late => {
        if (sealed) closeTransport(late).catch(() => {});
      }, () => {});
      connection = await bounded(connecting);
      if (!connection || typeof connection.close !== 'function' ||
          typeof connection.frames?.[Symbol.asyncIterator] !== 'function')
        throw new ContractError('INVALID_CIPHERTEXT_TRANSPORT');
      if (controller.signal.aborted) return;
      const iterator = connection.frames[Symbol.asyncIterator]();
      if (!iterator || typeof iterator.next !== 'function')
        throw new ContractError('INVALID_CIPHERTEXT_TRANSPORT');
      try {
        while (!controller.signal.aborted) {
          const result = await bounded(Promise.resolve().then(() => iterator.next()));
          if (controller.signal.aborted) break;
          if (!result || typeof result !== 'object' || typeof result.done !== 'boolean')
            throw new ContractError('INVALID_CIPHERTEXT_FRAME');
          if (result.done) {
            // End of a supposedly always-on source is unavailable, not success.
            state = 'unavailable';
            errorCode = 'STATION_STREAM_ENDED';
            break;
          }
          const frame = result.value;
          if (!frame || Object.getPrototypeOf(frame) !== Object.prototype ||
              Object.keys(frame).length !== 1 || !(frame.ciphertext instanceof Uint8Array) ||
              frame.ciphertext.byteLength < 1 || frame.ciphertext.byteLength > maxFrameBytes)
            throw new ContractError('INVALID_CIPHERTEXT_FRAME');
          // At most one bounded frame is handed to the endpoint at a time. Pull
          // the next frame only after acceptance, propagating backpressure.
          await bounded(Promise.resolve().then(() => endpoint.writeCiphertext(
            new Uint8Array(frame.ciphertext), {join,signal:controller.signal})));
          if (controller.signal.aborted) break;
          const reported = typeof endpoint.evidence === 'function' ? endpoint.evidence() : 'unavailable';
          if (!['verified','unverified','unavailable'].includes(reported))
            throw new ContractError('INVALID_EVIDENCE_STATE');
          evidenceStatus = reported;
          state = 'playing';
          notify();
        }
      } finally {
        if (typeof iterator.return === 'function')
          await bounded(Promise.resolve().then(() => iterator.return()));
      }
    } catch (error) {
      failed = true;
      state = 'unavailable';
      // Adapter exceptions can contain private paths/tokens. Expose only stable
      // facade errors; never relay arbitrary provider messages in state/logs.
      errorCode = error instanceof ContractError && publicErrors.has(error.message)
        ? error.message : 'PLAYBACK_ADAPTER_FAILED';
    } finally {
      controller.abort();
      evidenceStatus = 'unavailable';
      try { await bounded(close()); }
      catch { sealed = true; state = 'unavailable'; errorCode = 'PLAYBACK_CLOSE_FAILED'; }
      if (!failed && state !== 'unavailable') state = 'stopped';
      notify();
    }
    return status();
  }

  function start() {
    if (running) return running;
    if (sealed) return Promise.reject(new ContractError('Playback session requires disposal after adapter failure'));
    controller = new AbortController();
    connection = null;
    closePromise = null;
    join = null;
    errorCode = null;
    state = 'connecting';
    notify();
    const task = pump();
    running = task.finally(() => { running = null; });
    return running;
  }

  async function stop() {
    if (!running) return status();
    controller.abort();
    state = 'stopping';
    evidenceStatus = 'unavailable';
    notify();
    try {
      // Close only a connection already returned by connect. If connect is
      // pending, pump owns its eventual close before the next start is allowed.
      if (connection) await bounded(close());
      await bounded(running);
    } catch {
      sealed = true;
      state = 'unavailable';
      errorCode = 'PLAYBACK_CLOSE_FAILED';
    }
    return status();
  }

  async function recover() {
    await stop();
    if (sealed) throw new ContractError('Unsettled adapter prevents safe recovery');
    state = 'recovering';
    return start();
  }

  return Object.freeze({start,stop,recover,status});
}

export const createWebRadioPlayback = options => createRadioPlayback({...options,clientType:'web'});
export const createNativeRadioPlayback = options => createRadioPlayback({...options,clientType:'native'});
