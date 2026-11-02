import { createHash } from 'node:crypto';
import { assertObject, createStation, id, ContractError } from './contracts.mjs';
import { buildStationRotation, radioPositionAt } from './rotation.mjs';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const FIELDS = Object.freeze(['tenantId', 'stationId', 'segmentRef', 'assetRef', 'ciphertextSha256']);
const ROOT_FIELDS = Object.freeze(['stationId', 'tenantId', 'schedule', 'assets']);

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new ContractError('Invalid ' + field);
  return value;
}

function exactFields(value, fields, name) {
  assertObject(value, name);
  const names = Object.keys(value);
  if (names.length !== fields.length || names.some(field => !fields.includes(field)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(desc => !('value' in desc)))
    throw new ContractError('Unexpected ' + name + ' fields');
}

function sanitizeSchedule(rotation, stationId, verifyEditorialApproval, station) {
  const source = buildStationRotation(rotation);
  const blocks = source.blocks.map(({ effectiveAt, program }) => {
    if (!DIGEST.test(program.digest) || !Number.isSafeInteger(program.version) || program.version < 1)
      throw new ContractError('Unverifiable program identity');
    if (verifyEditorialApproval && verifyEditorialApproval(program, station) !== true)
      throw new ContractError('Program publication not approved');
    const timeline = program.timeline.map(cue => {
      assertObject(cue, 'program cue');
      const safe = Object.freeze({
        ref: id(cue.ref, 'program cue ref'),
        role: cue.role,
        fromMs: integer(cue.fromMs, 'cue start'),
        toMs: integer(cue.toMs, 'cue end', 1),
        occurrenceId: integer(cue.occurrenceId, 'cue occurrence', 1)
      });
      if (!['opening', 'closing', 'content', 'sponsor'].includes(safe.role))
        throw new ContractError('Unrecognized ciphertext cue role');
      if (safe.toMs <= safe.fromMs || safe.toMs > program.durationMs)
        throw new ContractError('Invalid cue timing');
      return safe;
    });
    const safeProgram = Object.freeze({
      stationId,
      version: program.version,
      digest: program.digest,
      durationMs: integer(program.durationMs, 'program duration', 1),
      timeline: Object.freeze(timeline)
    });
    return Object.freeze({ effectiveAt: integer(effectiveAt, 'activation time'), program: safeProgram });
  });
  return buildStationRotation({ stationId, blocks });
}

function sanitizePrepared(prepared) {
  exactFields(prepared, ROOT_FIELDS, 'staged station');
  const stationId = id(prepared.stationId, 'station id');
  const tenantId = id(prepared.tenantId, 'tenant id');
  const schedule = sanitizeSchedule(prepared.schedule, stationId);
  const required = new Set(schedule.blocks.flatMap(({ program }) =>
    program.timeline.map(cue => cue.ref)));
  if (!Array.isArray(prepared.assets) || prepared.assets.length !== required.size)
    throw new ContractError('Every broadcast cue requires exactly one ciphertext asset');
  const seen = new Set();
  const assets = prepared.assets.map(raw => {
    exactFields(raw, FIELDS, 'ciphertext publication record');
    const item = Object.freeze({
      tenantId: id(raw.tenantId, 'tenant id'),
      stationId: id(raw.stationId, 'station id'),
      segmentRef: id(raw.segmentRef, 'program cue ref'),
      assetRef: id(raw.assetRef, 'ciphertext asset ref'),
      ciphertextSha256: raw.ciphertextSha256
    });
    if (item.tenantId !== tenantId || item.stationId !== stationId)
      throw new ContractError('Cross-tenant or cross-station ciphertext denied');
    if (!item.assetRef.startsWith('ciphertext:') || !DIGEST.test(item.ciphertextSha256))
      throw new ContractError('Ciphertext publication lacks encrypted asset and strong hash');
    if (!required.has(item.segmentRef) || seen.has(item.segmentRef))
      throw new ContractError('Duplicate or unsolicited ciphertext cue');
    seen.add(item.segmentRef);
    return item;
  });
  return Object.freeze({ stationId, tenantId, schedule, assets: Object.freeze(assets) });
}

function snapshotDigest(prepared) {
  return 'sha256:' + createHash('sha256').update(JSON.stringify(prepared)).digest('hex');
}

/**
 * DRE-10 (stage 1): validate an already-approved radio rotation and immutable,
 * endpoint-published ciphertext asset references for unattended playout.
 *
 * This is not an encryption implementation, storage service, audio decoder, or
 * license validator. Actual availability, signed publication and rights decisions
 * must be provided by trusted adapters; all fail closed when absent/revoked.
 * The scheduler is deliberately not given media keys, plaintext or manifests.
 */
export function stageEncryptedRadioBroadcast({
  station, rotation, assets, verifyEditorialApproval, verifyCiphertextAvailable
}) {
  const checkedStation = createStation(station);
  if (checkedStation.status !== 'active') throw new ContractError('Station is not active');
  assertObject(rotation, 'rotation');
  if (rotation.stationId !== checkedStation.id)
    throw new ContractError('Rotation station does not match authorization');
  if (typeof verifyEditorialApproval !== 'function' ||
      typeof verifyCiphertextAvailable !== 'function')
    throw new ContractError('Trusted publication and ciphertext availability adapters required');
  const schedule = sanitizeSchedule(rotation, checkedStation.id, verifyEditorialApproval, checkedStation);
  const required = new Set();
  for (const { program } of schedule.blocks) {
    for (const cue of program.timeline) {
      required.add(cue.ref);
    }
  }
  if (!Array.isArray(assets) || assets.length !== required.size)
    throw new ContractError('Every broadcast cue requires exactly one ciphertext asset');
  const catalog = new Map();
  const safeAssets = [];
  for (const raw of assets) {
    assertObject(raw, 'ciphertext publication record');
    exactFields(raw, FIELDS, 'ciphertext publication record');
    const item = Object.freeze({
      tenantId: id(raw.tenantId, 'tenant id'),
      stationId: id(raw.stationId, 'station id'),
      segmentRef: id(raw.segmentRef, 'program cue ref'),
      assetRef: id(raw.assetRef, 'ciphertext asset ref'),
      ciphertextSha256: raw.ciphertextSha256
    });
    if (item.tenantId !== checkedStation.tenantId || item.stationId !== checkedStation.id)
      throw new ContractError('Cross-tenant or cross-station ciphertext denied');
    if (!item.assetRef.startsWith('ciphertext:') || !DIGEST.test(item.ciphertextSha256))
      throw new ContractError('Ciphertext publication lacks encrypted asset and strong hash');
    if (!required.has(item.segmentRef) || catalog.has(item.segmentRef))
      throw new ContractError('Duplicate or unsolicited ciphertext cue');
    catalog.set(item.segmentRef, item);
    safeAssets.push(item);
  }
  for (const { program } of schedule.blocks) {
    for (const cue of program.timeline) {
      const item = catalog.get(cue.ref);
      if (!item || verifyCiphertextAvailable(item, {
        stationId: checkedStation.id,
        programDigest: program.digest,
        version: program.version,
        segmentRole: cue.role
      }) !== true) throw new ContractError('Required ciphertext unavailable or unverified');
    }
  }
  return sanitizePrepared(Object.freeze({
    stationId: checkedStation.id,
    tenantId: checkedStation.tenantId,
    schedule,
    assets: Object.freeze(safeAssets)
  }));
}

/**
 * Deterministic crash/restart-safe playhead, without an artist phone.
 * No cue is returned unless current station/rights and asset availability
 * are freshly verified; merely staging once never permits stale delivery.
 */
export function encryptedRadioCueAt(prepared, nowMs, {
  verifyPlayoutRights, verifyCiphertextAvailable
} = {}) {
  assertObject(prepared, 'staged station');
  if (typeof verifyPlayoutRights !== 'function' ||
      typeof verifyCiphertextAvailable !== 'function')
    throw new ContractError('Fresh broadcast-rights and asset authorization required');
  const position = radioPositionAt(prepared.schedule, nowMs);
  const item = prepared.assets.find(asset => asset.segmentRef === position.segmentRef);
  if (!item || item.tenantId !== prepared.tenantId || item.stationId !== prepared.stationId)
    throw new ContractError('No authorized ciphertext for current cue');
  if (verifyPlayoutRights({
    tenantId: prepared.tenantId,
    stationId: prepared.stationId,
    programDigest: position.digest,
    version: position.version,
    atMs: nowMs
  }) !== true || verifyCiphertextAvailable(item, {
    stationId: prepared.stationId,
    programDigest: position.digest,
    version: position.version,
    segmentRole: position.segmentRole,
    atMs: nowMs
  }) !== true) throw new ContractError('Live authorization or encrypted asset revoked');
  return Object.freeze({
    stationId: prepared.stationId,
    programDigest: position.digest,
    version: position.version,
    cycle: position.cycle,
    cycleStartedAt: position.cycleStartedAt,
    segmentRole: position.segmentRole,
    segmentRef: position.segmentRef,
    segmentOffsetMs: position.segmentOffsetMs,
    ciphertextAssetRef: item.assetRef,
    ciphertextSha256: item.ciphertextSha256
  });
}

/**
 * Development/test state adapter for the DRE-10 persistence contract. A
 * production adapter must provide the same atomic publish/claim/read behavior
 * using durable storage. The adapter stores only the sanitized public schedule,
 * opaque ciphertext references and hashes.
 */
export function createMemoryStationOperationsStore() {
  const records = new Map();
  return Object.freeze({
    publish(prepared, { expectedRevision, atMs }) {
      const safe = sanitizePrepared(prepared);
      integer(expectedRevision, 'expected revision');
      integer(atMs, 'publication time');
      const prior = records.get(safe.stationId);
      const revision = prior?.revision ?? 0;
      if (revision !== expectedRevision) throw new ContractError('Station publication revision conflict');
      const record = {
        prepared: safe,
        digest: snapshotDigest(safe),
        revision: revision + 1,
        publishedAt: atMs,
        nextFence: (prior?.nextFence ?? 0) + 1,
        lease: null
      };
      records.set(safe.stationId, record);
      return Object.freeze({ stationId: safe.stationId, digest: record.digest,
        revision: record.revision, publishedAt: record.publishedAt });
    },
    claim({ stationId, workerId, atMs, ttlMs }) {
      stationId = id(stationId, 'station id');
      workerId = id(workerId, 'worker id');
      integer(atMs, 'lease time');
      integer(ttlMs, 'lease duration', 1);
      const record = records.get(stationId);
      if (!record) throw new ContractError('Station publication not found');
      if (record.lease && record.lease.expiresAt > atMs && record.lease.workerId !== workerId)
        throw new ContractError('Station already has an active worker');
      const fencingToken = record.nextFence++;
      record.lease = Object.freeze({ workerId, fencingToken, expiresAt: atMs + ttlMs,
        revision: record.revision, digest: record.digest });
      return record.lease;
    },
    read({ stationId, workerId, fencingToken, atMs }) {
      stationId = id(stationId, 'station id');
      workerId = id(workerId, 'worker id');
      integer(fencingToken, 'fencing token', 1);
      integer(atMs, 'lease read time');
      const record = records.get(stationId);
      const lease = record?.lease;
      if (!lease || lease.workerId !== workerId || lease.fencingToken !== fencingToken ||
          lease.expiresAt <= atMs || lease.revision !== record.revision || lease.digest !== record.digest)
        throw new ContractError('Missing, expired or fenced station lease');
      return record.prepared;
    }
  });
}

/**
 * Runtime facade over an atomic state-store adapter. Recreating the facade with
 * the same durable adapter recovers the approved fixed schedule; a newer lease
 * fences every stale worker before it can return a cue.
 */
export function createEncryptedStationRuntime({
  store, workerId, leaseTtlMs, verifyPlayoutRights, verifyCiphertextAvailable
}) {
  if (!store || typeof store.publish !== 'function' || typeof store.claim !== 'function' ||
      typeof store.read !== 'function') throw new ContractError('Atomic station state store required');
  workerId = id(workerId, 'worker id');
  integer(leaseTtlMs, 'lease duration', 1);
  if (typeof verifyPlayoutRights !== 'function' || typeof verifyCiphertextAvailable !== 'function')
    throw new ContractError('Fresh broadcast-rights and asset authorization required');
  return Object.freeze({
    publish(prepared, { expectedRevision = 0, atMs } = {}) {
      return store.publish(sanitizePrepared(prepared), { expectedRevision, atMs });
    },
    claim(stationId, atMs) {
      return store.claim({ stationId, workerId, atMs, ttlMs: leaseTtlMs });
    },
    cueAt(stationId, lease, atMs) {
      assertObject(lease, 'station lease');
      const prepared = store.read({ stationId, workerId,
        fencingToken: lease.fencingToken, atMs });
      return encryptedRadioCueAt(prepared, atMs, {
        verifyPlayoutRights, verifyCiphertextAvailable
      });
    }
  });
}

