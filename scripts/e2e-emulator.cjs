/**
 * E2E: drive the REAL compiled Cloud Functions against the Firestore emulator.
 *   Flow A — free 4-player singles bracket: create → publish → 4 enters →
 *            close (seed+draw) → schedule+play both semis → final →
 *            completion → awards. Verifies every stage.
 *   Flow B — paid stroke-play (built directly in Firestore, Stripe off):
 *            completion math — team split, tie split, $10 min fee → ledger rows.
 *   Flow C — instant event template validation.
 */
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'the-draw-test';
process.env.GOOGLE_CLOUD_PROJECT = 'the-draw-test';

// Run from the repo root with the Firestore emulator up:
//   npx firebase-tools emulators:start --only firestore --project the-draw-test
//   node scripts/e2e-emulator.cjs
const path = require('node:path').join(__dirname, '..', 'functions');
const admin = require(path + '/node_modules/firebase-admin');
const fns = require(path + '/lib/index.js');
const { maybeCompleteTournament } = require(path + '/lib/completion.js');
const { boardSweep } = require(path + '/lib/boardlife.js');
const { drawSweep } = require(path + '/lib/draw.js');
const { createScorecards } = require(path + '/lib/lib/matchgen.js');

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL ${name}${extra ? ' — ' + JSON.stringify(extra).slice(0, 200) : ''}`); }
}
const call = (fn, uid, data) => fn.run({ auth: { uid, token: {} }, data, rawRequest: {} });

async function makeUser(uid, name, index, opts = {}) {
  await db.doc(`users/${uid}`).set({
    marketId: 'kc', displayName: name, photoUrl: null, age: 30, gender: 'other',
    phone: `+1816555${uid.slice(-4).padStart(4, '0')}`,
    handicap: { index, source: 'ghin', ghinNumber: '123', sourceUrl: null,
      verifiedAt: Timestamp.now(), verifiedBy: 'org1' },
    role: opts.role ?? 'member', organizerMarkets: opts.role === 'organizer' ? ['kc'] : [],
    canCreatePaidEvents: opts.role === 'organizer', stripeCustomerId: 'cus_x', stripeConnectId: null,
    createdAt: Timestamp.fromMillis(Date.now() - 60 * 86400000), status: 'active',
    areas: opts.areas ?? [],
  });
}

async function main() {
  // ---------- wipe the emulator so runs are idempotent ----------
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );

  // ---------- seed ----------
  await db.doc('markets/kc').set({
    id: 'kc', name: 'Kansas City', timezone: 'America/Chicago',
    activeSeasonStart: Timestamp.now(), activeSeasonEnd: Timestamp.now(),
    paidEventsEnabled: true, enabledFormats: ['singlesMatch'], organizerIds: ['org1'], adminFeePercent: 25,
  });
  await db.doc('formats/singlesMatch').set({
    id: 'singlesMatch', name: 'Singles Match Play', teamSize: 1, scoring: 'matchPlay',
    handicapAllowance: null, advancement: 'bracket', holes: 18, flightBy: 'individualIndex',
    requiresWitness: true, eligibleForMoney: true,
  });
  await db.doc('formats/grossFoursome').set({
    id: 'grossFoursome', name: 'Gross Foursome', teamSize: 1, scoring: 'strokePlay',
    handicapAllowance: null, advancement: 'singleRound', groupSize: 4, flightBy: 'individualIndex',
    requiresWitness: true, eligibleForMoney: true,
  });
  await db.doc('eventTemplates/sundayFoursome').set({
    marketId: 'kc', name: 'Sunday Foursome', formatId: 'grossFoursome', fieldSize: 4,
    entryFeeMinCents: 2000, entryFeeMaxCents: 20000,
    allowedPayoutShapes: ['winnerTakeAll', '70_30'], adminFeePercent: 10,
    requiresGhinAboveCents: 7500, active: true,
  });
  await makeUser('org1', 'Olive Organizer', 5.0, { role: 'organizer' });
  await makeUser('p1', 'Doyle, K.', 7.1);
  await makeUser('p2', 'Harding, J.', 12.4);
  await makeUser('p3', 'Vogel, M.', 15.8);
  await makeUser('p4', 'Chen, A.', 4.2);

  // ================= FLOW A — free bracket =================
  console.log('\nFLOW A — free 4-player singles bracket');
  const { tournamentId: tid } = await call(fns.createTournament, 'org1', {
    formatId: 'singlesMatch', name: 'Test Cup', description: '',
    entryFeeCents: 0, adminFeePercent: 0,
    payoutTable: [], divisionMode: 'grossOnly', doubleDipRule: 'onePrizePerPlayer',
    prizeType: 'cashPurse', minEntries: 4, maxEntries: 4,
    registrationOpens: Date.now() - 1000, registrationCloses: Date.now() + 3600000,
    structure: 'bracket', roundDeadlineDays: 7,
  });
  check('createTournament returns id', !!tid);
  await call(fns.publishTournament, 'org1', { tournamentId: tid });
  check('published → open', (await db.doc(`tournaments/${tid}`).get()).data().status === 'open');

  const entries = {};
  for (const uid of ['p1', 'p2', 'p3', 'p4']) {
    const r = await call(fns.enterTournament, uid, { tournamentId: tid });
    entries[uid] = r.entryId;
  }
  check('4 entries created', Object.keys(entries).length === 4);

  // duplicate entry rejected
  let dup = false;
  try { await call(fns.enterTournament, 'p1', { tournamentId: tid }); } catch { dup = true; }
  check('duplicate entry rejected', dup);

  await call(fns.closeRegistration, 'org1', { tournamentId: tid });
  const tAfter = (await db.doc(`tournaments/${tid}`).get()).data();
  check('close → inProgress', tAfter.status === 'inProgress');
  check('bracketRounds = 2', tAfter.bracketRounds === 2, tAfter.bracketRounds);

  // Seeding: p4 (4.2) seed 1, p1 (7.1) seed 2, p2 (12.4) seed 3, p3 (15.8) seed 4
  const eDocs = {};
  for (const [uid, eid] of Object.entries(entries)) eDocs[uid] = (await db.doc(`entries/${eid}`).get()).data();
  check('seeded by index (p4=1, p1=2, p2=3, p3=4)',
    eDocs.p4.seed === 1 && eDocs.p1.seed === 2 && eDocs.p2.seed === 3 && eDocs.p3.seed === 4,
    Object.fromEntries(Object.entries(eDocs).map(([k, v]) => [k, v.seed])));

  // R1: m0 = seed1 v seed4 (p4 v p3), m1 = seed2 v seed3 (p1 v p2)
  const m0 = (await db.doc(`matches/${tid}_r1_m0`).get()).data();
  const m1 = (await db.doc(`matches/${tid}_r1_m1`).get()).data();
  check('R1 m0 = p4 vs p3', m0 && m0.entryIds.includes(entries.p4) && m0.entryIds.includes(entries.p3));
  check('R1 m1 = p1 vs p2', m1 && m1.entryIds.includes(entries.p1) && m1.entryIds.includes(entries.p2));

  // Play m0: availability → agree → result → confirm
  const day = Date.now() + 2 * 86400000;
  await call(fns.submitAvailability, 'p4', { matchId: `${tid}_r1_m0`, dates: [day, day + 86400000, day + 2 * 86400000] });
  await call(fns.submitAvailability, 'p3', { matchId: `${tid}_r1_m0`, dates: [day, day + 3 * 86400000, day + 4 * 86400000] });
  await call(fns.setAgreedTime, 'p4', { matchId: `${tid}_r1_m0`, agreedTime: day, placeId: null, bookedBy: 'p4' });
  check('m0 scheduled', (await db.doc(`matches/${tid}_r1_m0`).get()).data().status === 'scheduled');

  await call(fns.submitResult, 'p4', { matchId: `${tid}_r1_m0`, winnerEntryId: entries.p4, margin: '3&2' });
  check('m0 awaitingConfirmation', (await db.doc(`matches/${tid}_r1_m0`).get()).data().status === 'awaitingConfirmation');
  // Submitter cannot confirm own result
  let selfConfirm = false;
  try { await call(fns.confirmResult, 'p4', { matchId: `${tid}_r1_m0` }); } catch { selfConfirm = true; }
  check('submitter cannot self-confirm', selfConfirm);
  await call(fns.confirmResult, 'p3', { matchId: `${tid}_r1_m0` });
  check('m0 complete', (await db.doc(`matches/${tid}_r1_m0`).get()).data().status === 'complete');
  check('loser eliminated', (await db.doc(`entries/${entries.p3}`).get()).data().status === 'eliminated');

  // Play m1 the same way, p1 wins
  await call(fns.submitAvailability, 'p1', { matchId: `${tid}_r1_m1`, dates: [day, day + 86400000, day + 2 * 86400000] });
  await call(fns.submitAvailability, 'p2', { matchId: `${tid}_r1_m1`, dates: [day, day + 86400000, day + 5 * 86400000] });
  await call(fns.setAgreedTime, 'p1', { matchId: `${tid}_r1_m1`, agreedTime: day, placeId: null, bookedBy: 'p1' });
  await call(fns.submitResult, 'p1', { matchId: `${tid}_r1_m1`, winnerEntryId: entries.p1, margin: '2&1' });
  await call(fns.confirmResult, 'p2', { matchId: `${tid}_r1_m1` });

  // Final should exist with both winners
  const fin = (await db.doc(`matches/${tid}_r2_m0`).get()).data();
  check('final = p4 vs p1', fin && fin.entryIds.includes(entries.p4) && fin.entryIds.includes(entries.p1), fin && fin.entryIds);
  check('final in scheduling', fin && fin.status === 'scheduling');

  // Play the final, p1 upsets p4
  await call(fns.submitAvailability, 'p4', { matchId: `${tid}_r2_m0`, dates: [day, day + 86400000, day + 2 * 86400000] });
  await call(fns.submitAvailability, 'p1', { matchId: `${tid}_r2_m0`, dates: [day, day + 86400000, day + 2 * 86400000] });
  await call(fns.setAgreedTime, 'p1', { matchId: `${tid}_r2_m0`, agreedTime: day + 86400000, placeId: null, bookedBy: 'p1' });
  await call(fns.submitResult, 'p1', { matchId: `${tid}_r2_m0`, winnerEntryId: entries.p1, margin: '1 up' });
  await call(fns.confirmResult, 'p4', { matchId: `${tid}_r2_m0` });

  const tDone = (await db.doc(`tournaments/${tid}`).get()).data();
  check('tournament complete', tDone.status === 'complete', tDone.status);

  const awards = await db.collection('awards').where('tournamentId', '==', tid).get();
  const byUser = {};
  awards.docs.forEach((d) => { byUser[d.data().userId] = d.data().placement; });
  check('champion = p1', byUser.p1 === 'champion', byUser);
  check('runnerUp = p4', byUser.p4 === 'runnerUp', byUser);
  check('awards denormalize name', awards.docs[0].data().tournamentName === 'Test Cup');
  const champPath = awards.docs.find((d) => d.data().placement === 'champion').data().path;
  check('champion path has 2 wins', champPath.length === 2, champPath);

  const reps = await db.collection('reputationEvents').where('userId', '==', 'p1').get();
  const types = reps.docs.map((d) => d.data().type).sort();
  check('p1 reputation: committed + played recorded', types.includes('committed') && types.includes('played'), types);

  // ================= FLOW B — paid stroke play, ties + team split + min fee =================
  console.log('\nFLOW B — paid completion math (Stripe off)');
  // Build directly: $50 entry, 10% admin, 4 entries, one is a TEAM of two.
  // p1 and p2 TIE for 1st gross. Payout 70/30.
  const tid2 = 'paidTest1';
  await db.doc(`tournaments/${tid2}`).set({
    marketId: 'kc', formatId: 'grossFoursome', createdBy: 'org1', name: 'Paid Test',
    description: '', entryFeeCents: 5000, adminFeePercent: 10,
    payoutTable: [
      { division: 'gross', place: 1, sharePercent: 70 },
      { division: 'gross', place: 2, sharePercent: 30 }],
    divisionMode: 'grossOnly', doubleDipRule: 'onePrizePerPlayer', prizeType: 'cashPurse',
    sponsoredPrizes: null, minEntries: 3, maxEntries: 4,
    registrationOpens: Timestamp.now(), registrationCloses: Timestamp.now(),
    eligibility: {}, structure: 'singleRound', roundDeadlineDays: 1,
    status: 'inProgress', entryIds: ['e1', 'e2', 'e3'],
  });
  const mkEntry = (id, userIds, teamName) => db.doc(`entries/${id}`).set({
    tournamentId: tid2, userIds, teamId: null, teamName: teamName ?? null,
    captainId: userIds[0], combinedIndex: 10, flight: null, seed: 1,
    paymentIntentId: 'pi_x', paymentStatus: 'captured', status: 'active',
  });
  await mkEntry('e1', ['p1']);
  await mkEntry('e2', ['p2']);
  await mkEntry('e3', ['p3', 'p4'], 'Sand Save'); // the team
  const mkCard = (eid, uid, gross) => db.doc(`scorecards/${tid2}_${eid}_1`).set({
    tournamentId: tid2, entryId: eid, userId: uid, round: 1, placeId: 'x',
    gross, courseHandicap: null, net: null, holes: null, submittedBy: uid,
    confirmedBy: 'org1', confirmDeadline: null, scorecardPhotoUrl: null, status: 'complete',
  });
  await mkCard('e1', 'p1', 74); // tie 1st
  await mkCard('e2', 'p2', 74); // tie 1st
  await mkCard('e3', 'p3', 80); // team takes 3rd... wait, 3 entries: tie 1st+1st, then e3 3rd place — only 2 places paid.
  await maybeCompleteTournament(tid2);

  const t2 = (await db.doc(`tournaments/${tid2}`).get()).data();
  check('paid tournament complete', t2.status === 'complete', t2.status);

  // Money: collected 3×5000=15000; admin = max(3×500, 1000)=1500; pool=13500
  // Tie for 1st: e1+e2 split (70%+30%) of 13500 = 13500 → 6750 each. e3 gets 0.
  const ledger = await db.collection('ledger').where('tournamentId', '==', tid2).get();
  const payouts = ledger.docs.map((d) => d.data()).filter((r) => r.type === 'payout');
  const total = payouts.reduce((a, r) => a + r.amountCents, 0);
  check('pool = 13500 (min fee applied at 10% → percentage fee larger)', total === 13500, total);
  const byUser2 = {};
  payouts.forEach((r) => { byUser2[r.toUserId] = (byUser2[r.toUserId] ?? 0) + r.amountCents; });
  check('tie split: p1 = 6750', byUser2.p1 === 6750, byUser2);
  check('tie split: p2 = 6750', byUser2.p2 === 6750, byUser2);
  check('team got nothing (3rd of 2 places)', !byUser2.p3 && !byUser2.p4, byUser2);

  // FLOW B2 — team WINS: verify even individual transfers
  const tid3 = 'paidTest2';
  await db.doc(`tournaments/${tid3}`).set({
    marketId: 'kc', formatId: 'grossFoursome', createdBy: 'org1', name: 'Team Win Test',
    description: '', entryFeeCents: 10000, adminFeePercent: 10,
    payoutTable: [{ division: 'gross', place: 1, sharePercent: 100 }],
    divisionMode: 'grossOnly', doubleDipRule: 'onePrizePerPlayer', prizeType: 'cashPurse',
    sponsoredPrizes: null, minEntries: 2, maxEntries: 2,
    registrationOpens: Timestamp.now(), registrationCloses: Timestamp.now(),
    eligibility: {}, structure: 'singleRound', roundDeadlineDays: 1,
    status: 'inProgress', entryIds: ['t3e1', 't3e2'],
  });
  await db.doc('entries/t3e1').set({ tournamentId: tid3, userIds: ['p3', 'p4'], teamId: null, teamName: 'Sand Save', captainId: 'p3', combinedIndex: 20, flight: null, seed: 1, paymentIntentId: 'pi', paymentStatus: 'captured', status: 'active' });
  await db.doc('entries/t3e2').set({ tournamentId: tid3, userIds: ['p1', 'p2'], teamId: null, teamName: 'The Grinders', captainId: 'p1', combinedIndex: 19, flight: null, seed: 2, paymentIntentId: 'pi', paymentStatus: 'captured', status: 'active' });
  await db.doc(`scorecards/${tid3}_t3e1_1`).set({ tournamentId: tid3, entryId: 't3e1', userId: 'p3', round: 1, placeId: 'x', gross: 68, courseHandicap: null, net: null, holes: null, submittedBy: 'p3', confirmedBy: 'org1', confirmDeadline: null, scorecardPhotoUrl: null, status: 'complete' });
  await db.doc(`scorecards/${tid3}_t3e2_1`).set({ tournamentId: tid3, entryId: 't3e2', userId: 'p1', round: 1, placeId: 'x', gross: 71, courseHandicap: null, net: null, holes: null, submittedBy: 'p1', confirmedBy: 'org1', confirmDeadline: null, scorecardPhotoUrl: null, status: 'complete' });
  await maybeCompleteTournament(tid3);
  // collected 2×10000=20000; admin=max(2000,1000)=2000; pool=18000; team of 2 wins → 9000 each
  const l3 = await db.collection('ledger').where('tournamentId', '==', tid3).get();
  const pay3 = l3.docs.map((d) => d.data()).filter((r) => r.type === 'payout');
  const by3 = {};
  pay3.forEach((r) => { by3[r.toUserId] = r.amountCents; });
  check('team split individually: p3 = 9000', by3.p3 === 9000, by3);
  check('team split individually: p4 = 9000', by3.p4 === 9000, by3);
  check('2 separate transfers, never lumped', pay3.length === 2, pay3.length);

  // Min-fee dominance: tiny event — 2 × $20, 10% → $4 < $10 min → pool 3000
  const tid4 = 'paidTest3';
  await db.doc(`tournaments/${tid4}`).set({
    marketId: 'kc', formatId: 'grossFoursome', createdBy: 'org1', name: 'Tiny Event',
    description: '', entryFeeCents: 2000, adminFeePercent: 10,
    payoutTable: [{ division: 'gross', place: 1, sharePercent: 100 }],
    divisionMode: 'grossOnly', doubleDipRule: 'onePrizePerPlayer', prizeType: 'cashPurse',
    sponsoredPrizes: null, minEntries: 2, maxEntries: 2,
    registrationOpens: Timestamp.now(), registrationCloses: Timestamp.now(),
    eligibility: {}, structure: 'singleRound', roundDeadlineDays: 1,
    status: 'inProgress', entryIds: ['t4e1', 't4e2'],
  });
  await db.doc('entries/t4e1').set({ tournamentId: tid4, userIds: ['p1'], teamId: null, teamName: null, captainId: 'p1', combinedIndex: 7, flight: null, seed: 1, paymentIntentId: 'pi', paymentStatus: 'captured', status: 'active' });
  await db.doc('entries/t4e2').set({ tournamentId: tid4, userIds: ['p2'], teamId: null, teamName: null, captainId: 'p2', combinedIndex: 12, flight: null, seed: 2, paymentIntentId: 'pi', paymentStatus: 'captured', status: 'active' });
  await db.doc(`scorecards/${tid4}_t4e1_1`).set({ tournamentId: tid4, entryId: 't4e1', userId: 'p1', round: 1, placeId: 'x', gross: 70, courseHandicap: null, net: null, holes: null, submittedBy: 'p1', confirmedBy: 'p2', confirmDeadline: null, scorecardPhotoUrl: null, status: 'complete' });
  await db.doc(`scorecards/${tid4}_t4e2_1`).set({ tournamentId: tid4, entryId: 't4e2', userId: 'p2', round: 1, placeId: 'x', gross: 75, courseHandicap: null, net: null, holes: null, submittedBy: 'p2', confirmedBy: 'p1', confirmDeadline: null, scorecardPhotoUrl: null, status: 'complete' });
  await maybeCompleteTournament(tid4);
  const l4 = await db.collection('ledger').where('tournamentId', '==', tid4).get();
  const pay4 = l4.docs.map((d) => d.data()).filter((r) => r.type === 'payout');
  check('$10 min fee applied: winner gets 4000-1000=3000', pay4.length === 1 && pay4[0].amountCents === 3000 && pay4[0].toUserId === 'p1', pay4.map((r) => [r.toUserId, r.amountCents]));

  // ================= FLOW C — instant events =================
  console.log('\nFLOW C — instant event template validation');
  const { tournamentId: itid } = await call(fns.createInstantEvent, 'p1', {
    templateId: 'sundayFoursome', placeId: null, startsAt: Date.now() + 5 * 86400000,
    entryFeeCents: 5000, payoutShape: '70_30',
  });
  const inst = (await db.doc(`tournaments/${itid}`).get()).data();
  check('instant event live immediately', inst.status === 'open');
  check('instant fee = template 10%', inst.adminFeePercent === 10);
  check('payout table frozen from shape', inst.payoutTable.length === 2 && inst.payoutTable[0].sharePercent === 70);
  check('field = template size, runs full or not at all', inst.minEntries === 4 && inst.maxEntries === 4);

  // Creator MAY compete (needs Stripe for paid — expect the payments-not-configured error, NOT the organizer block)
  let creatorBlockMsg = '';
  try { await call(fns.enterTournament, 'p1', { tournamentId: itid }); } catch (e) { creatorBlockMsg = e.message; }
  check('creator not blocked as organizer (fails only on missing Stripe)', /Payments are not configured/.test(creatorBlockMsg), creatorBlockMsg);

  // Bounds enforced
  let bounds = false;
  try {
    await call(fns.createInstantEvent, 'p1', { templateId: 'sundayFoursome', placeId: null, startsAt: Date.now() + 86400000, entryFeeCents: 50000, payoutShape: '70_30' });
  } catch { bounds = true; }
  check('fee outside template bounds rejected', bounds);
  let badShape = false;
  try {
    await call(fns.createInstantEvent, 'p1', { templateId: 'sundayFoursome', placeId: null, startsAt: Date.now() + 86400000, entryFeeCents: 5000, payoutShape: '60_30_10' });
  } catch { badShape = true; }
  check('disallowed payout shape rejected', badShape);

  // ================= FLOW D — cancellation ladder (§5, deterministic) ========
  console.log('\nFLOW D — cancellation ladder');
  const mkSched = async (mid, eA, eB, uA, uB, hoursOut) => {
    await db.doc(`entries/${eA}`).set({ tournamentId: 'ladder', userIds: [uA], teamId: null, teamName: null, captainId: uA, combinedIndex: 8, flight: null, seed: 1, paymentIntentId: null, paymentStatus: 'captured', status: 'active' });
    await db.doc(`entries/${eB}`).set({ tournamentId: 'ladder', userIds: [uB], teamId: null, teamName: null, captainId: uB, combinedIndex: 9, flight: null, seed: 2, paymentIntentId: null, paymentStatus: 'captured', status: 'active' });
    await db.doc(`matches/${mid}`).set({
      tournamentId: 'ladder', round: 1, entryIds: [eA, eB],
      scheduling: { deadline: null, availabilityLog: [], extensionsUsed: {}, agreedTime: Timestamp.fromMillis(Date.now() + hoursOut * 3600000), placeId: null, bookedBy: uA },
      result: { submittedBy: null, submittedAt: null, winnerEntryId: null, margin: null, holes: null, confirmedBy: null, confirmedAt: null, disputed: false, scorecardPhotoUrl: null },
      status: 'scheduled', forfeitedBy: null, forfeitReason: null,
    });
  };
  await db.doc('tournaments/ladder').set({ marketId: 'kc', formatId: 'singlesMatch', createdBy: 'org1', name: 'Ladder', structure: 'bracket', status: 'inProgress', bracketRounds: 9, entryFeeCents: 0, prizeType: 'cashPurse', entryIds: [] });

  // >72h out → back to scheduling, one free reschedule per season
  await mkSched('lad_r1_m0', 'ladA', 'ladB', 'p1', 'p2', 100);
  const r1 = await call(fns.cancelScheduledMatch, 'p1', { matchId: 'lad_r1_m0' });
  check('>72h cancel → rescheduled', r1.outcome === 'rescheduled', r1);
  check('match back to scheduling', (await db.doc('matches/lad_r1_m0').get()).data().status === 'scheduling');
  // second free reschedule denied
  await db.doc('matches/lad_r1_m0').update({ status: 'scheduled', 'scheduling.agreedTime': Timestamp.fromMillis(Date.now() + 100 * 3600000) });
  let secondFree = false;
  try { await call(fns.cancelScheduledMatch, 'p1', { matchId: 'lad_r1_m0' }); } catch { secondFree = true; }
  check('second free reschedule denied', secondFree);

  // <24h out → forfeit by the canceller
  await mkSched('lad_r1_m1', 'ladC', 'ladD', 'p3', 'p4', 10);
  const r2 = await call(fns.cancelScheduledMatch, 'p3', { matchId: 'lad_r1_m1' });
  check('<24h cancel → forfeited', r2.outcome === 'forfeited', r2);
  const fm = (await db.doc('matches/lad_r1_m1').get()).data();
  check('forfeit charged to canceller, opponent advances', fm.forfeitedBy === 'ladC' && fm.result.winnerEntryId === 'ladD', { f: fm.forfeitedBy, w: fm.result.winnerEntryId });

  // ================= FLOW E — board lifecycle: sweep, standing game, attest ==
  console.log('\nFLOW E — board sweep + standing game + attestation');
  const teeMs = Date.now() - 3600000; // an hour ago — due for completion
  await db.doc('roundPosts/standing1').set({
    marketId: 'kc', createdBy: 'p1', title: 'Saturday standing game', description: null,
    timing: { mode: 'fixed', fixedTime: Timestamp.fromMillis(teeMs), windowStart: null, windowEnd: null, flexibleDays: null },
    course: { mode: 'specific', placeId: 'course_x', preferredPlaceIds: null },
    booking: 'booked', slotsTotal: 2, slotsFilled: 1, hosting: null,
    vibe: 'open', stakes: 'open', handicapPref: 'any', handicapRange: null, format: 'open',
    joinedUserIds: ['p2'], stakesAmount: null, stakesHandledByApp: false,
    recurrence: 'weekly', status: 'full', createdAt: Timestamp.now(),
  });
  await boardSweep(Date.now());
  check('post completed by sweep', (await db.doc('roundPosts/standing1').get()).data().status === 'completed');
  const clones = await db.collection('roundPosts').where('standingOriginId', '==', 'standing1').get();
  check('standing game respawned for next week', clones.size === 1);
  if (clones.size) {
    const c = clones.docs[0].data();
    check('clone is open with fresh slots', c.status === 'open' && c.slotsFilled === 0 && c.joinedUserIds.length === 0);
    check('clone tee time = +7 days', Math.abs(c.timing.fixedTime.toMillis() - (teeMs + 7 * 86400000)) < 1000);
  }
  // committed reputation written for the group
  const repP2 = await db.collection('reputationEvents').where('userId', '==', 'p2').where('type', '==', 'committed').get();
  check('committed reputation for joined player', repP2.size >= 1);

  // Attestation: p2 logs a round on the post; p1 (groupmate) attests it.
  const roundRef = await db.collection('rounds').add({
    userId: 'p2', placeId: 'course_x', playedAt: Timestamp.now(), holes: 18, totalScore: 84,
    teePosition: 'middle', teeName: null, yardage: null, source: 'selfReported',
    attestedBy: null, roundPostId: 'standing1',
  });
  // self-attest rejected
  let selfAttest = false;
  try { await call(fns.attestRound, 'p2', { roundId: roundRef.id }); } catch { selfAttest = true; }
  check('self-attest rejected', selfAttest);
  // outsider rejected
  let outsider = false;
  try { await call(fns.attestRound, 'p3', { roundId: roundRef.id }); } catch { outsider = true; }
  check('non-groupmate attest rejected', outsider);
  await call(fns.attestRound, 'p1', { roundId: roundRef.id });
  const attested = (await roundRef.get()).data();
  check('groupmate attest → source attested', attested.source === 'attested' && attested.attestedBy === 'p1');
  const playedRep = await db.collection('reputationEvents').where('userId', '==', 'p2').where('type', '==', 'played').get();
  check('played reputation written on attest', playedRep.size >= 1);

  // Run it back: a GROUP MEMBER (p2, not the creator) reruns the completed
  // post — new post next week, same group pre-invited, tapper hosts.
  let outsiderRerun = false;
  try { await call(fns.rerunPost, 'p3', { postId: 'standing1' }); } catch { outsiderRerun = true; }
  check('outsider cannot run it back', outsiderRerun);
  const rerun = await call(fns.rerunPost, 'p2', { postId: 'standing1' });
  const rr = (await db.doc(`roundPosts/${rerun.postId}`).get()).data();
  check('rerun exists, hosted by the tapper', rr.createdBy === 'p2' && rr.rerunOfId === 'standing1');
  check('rerun pre-invites the rest of the group', rr.joinedUserIds.length === 1 && rr.joinedUserIds[0] === 'p1');
  check('rerun is full and needs booking', rr.status === 'full' && rr.booking === 'needsBooking');
  check('rerun tee time moved to a future week', rr.timing.fixedTime.toMillis() > Date.now());

  // ================= FLOW F — Enter the Draw ================================
  console.log('\nFLOW F — Enter the Draw');
  // p5 is a 25-index outlier who must NOT be grouped with the 4-12 band.
  await makeUser('p5', 'Ruiz, T.', 25.0);
  // p1(7.1) p2(12.4) p3(15.8) p4(4.2): sorted 4.2,7.1,12.4,15.8 spread 11.6 > 8
  // → the greedy matcher should form a compatible smaller group instead.
  await call(fns.enterDraw, 'p4', { day: 'saturday' }); // 4.2, first in → booker
  await call(fns.enterDraw, 'p1', { day: 'saturday' }); // 7.1
  await call(fns.enterDraw, 'p2', { day: 'saturday', willingToBook: false }); // 12.4
  await call(fns.enterDraw, 'p5', { day: 'saturday', willingToBook: false }); // 25.0 outlier
  const dup2 = await call(fns.enterDraw, 'p4', { day: 'saturday' });
  check('re-entering is idempotent', dup2.alreadyIn === true);

  await drawSweep(Date.now());

  // Band math: 12.4 - 4.2 = 8.2 > 8, so p2 is (correctly) outside the band —
  // the matcher forms a two-ball (4.2, 7.1) rather than stretching the spread.
  const matched = await db.collection('playRequests').where('status', '==', 'matched').get();
  const matchedUsers = matched.docs.map((d) => d.data().userId).sort();
  check('band respected: only 4.2 + 7.1 grouped', matchedUsers.join(',') === 'p1,p4', matchedUsers);
  const stillOpen = await db.collection('playRequests').where('status', '==', 'open').get();
  const openUsers = stillOpen.docs.map((d) => d.data().userId);
  check('out-of-band players wait for the next draw', openUsers.includes('p5') && openUsers.includes('p2'), openUsers);

  const drawPosts = await db.collection('roundPosts').where('drawMatched', '==', true).get();
  check('draw created one group post', drawPosts.size === 1);
  if (drawPosts.size === 1) {
    const p = drawPosts.docs[0].data();
    check('post is full with named booker as creator', p.status === 'full' && p.createdBy === 'p4', { createdBy: p.createdBy, status: p.status });
    check('booker is willing + earliest (p2 unwilling was not chosen)', p.createdBy !== 'p2');
    check('others joined', p.joinedUserIds.length === 1 && p.slotsFilled === 2);
    check('handicap range recorded', Array.isArray(p.handicapRange) && p.handicapRange[0] === 4.2);
  }

  // ================= FLOW F2 — areas gate + confirm tee time ================
  console.log('\nFLOW F2 — area preferences + tee-time confirmation');
  // Disjoint areas at the same index must NOT be grouped; overlap must.
  await makeUser('p6', 'Ito, R.', 10.0, { areas: ['downtown'] });
  await makeUser('p7', 'Bax, L.', 10.5, { areas: ['joco'] });
  await call(fns.enterDraw, 'p6', { day: 'sunday' });
  await call(fns.enterDraw, 'p7', { day: 'sunday' });
  await drawSweep(Date.now());
  const sunOpen1 = (await db.collection('playRequests').where('status', '==', 'open').where('day', '==', 'sunday').get())
    .docs.map((d) => d.data().userId).sort();
  check('disjoint areas not grouped', sunOpen1.join(',') === 'p6,p7', sunOpen1);

  await makeUser('p8', 'Ott, S.', 10.2, { areas: ['joco', 'south'] });
  await call(fns.enterDraw, 'p8', { day: 'sunday' });
  await drawSweep(Date.now());
  const sunMatched = (await db.collection('playRequests').where('status', '==', 'matched').where('day', '==', 'sunday').get())
    .docs.map((d) => d.data().userId).sort();
  check('shared area (joco) grouped p7+p8', sunMatched.join(',') === 'p7,p8', sunMatched);
  const sunOpen2 = (await db.collection('playRequests').where('status', '==', 'open').where('day', '==', 'sunday').get())
    .docs.map((d) => d.data().userId);
  check('downtown-only player still waits', sunOpen2.includes('p6'), sunOpen2);

  const sunPost = (await db.collection('roundPosts').where('drawMatched', '==', true).get())
    .docs.find((d) => d.data().timing.flexibleDays?.includes('sunday'));
  check('sunday draw post exists', !!sunPost);
  if (sunPost) {
    const booker = sunPost.data().createdBy;
    const nonBooker = booker === 'p7' ? 'p8' : 'p7';
    let denied = false;
    try { await call(fns.confirmTeeTime, nonBooker, { postId: sunPost.id, teeTime: Date.now() + 86400000 }); }
    catch { denied = true; }
    check('only the booker confirms the tee time', denied);
    let pastRejected = false;
    try { await call(fns.confirmTeeTime, booker, { postId: sunPost.id, teeTime: Date.now() - 1000 }); }
    catch { pastRejected = true; }
    check('past tee time rejected', pastRejected);
    const tee = Date.now() + 3 * 86400000;
    await call(fns.confirmTeeTime, booker, { postId: sunPost.id, teeTime: tee, placeId: 'netCourse', courseName: 'Net Test CC' });
    const after = (await sunPost.ref.get()).data();
    check('post flips to booked + fixed time', after.booking === 'booked' && after.timing.mode === 'fixed'
      && after.timing.fixedTime.toMillis() === tee && after.course.placeId === 'netCourse',
      { booking: after.booking, mode: after.timing.mode });
  }

  // ================= FLOW G — stroke rules: frozen handicap + net ============
  console.log('\nFLOW G — stroke rules (gross vs net, frozen at draw)');
  // Supported course: slope 130, rating 72.5, par 71.
  await db.doc('courses/netCourse').set({
    placeId: 'netCourse', marketId: 'kc', name: 'Net Test CC', address: '', location: null,
    tier: 'supported', accessType: 'public', guestPolicy: null, bookingPlatform: null,
    bookingUrl: null, bookingWindowDays: null, bookingOpensAtLocal: null,
    holeHandicapOrder: null, holePars: null,
    teeSets: [{ name: 'Blue', yardage: 6500, rating: 72.5, slope: 130, par: 71 }],
    roundCount: 1,
  });
  const tid5 = 'netTest1';
  await db.doc(`tournaments/${tid5}`).set({
    marketId: 'kc', formatId: 'multiRoundStrokePlay', createdBy: 'org1', name: 'Net Test',
    status: 'inProgress', structure: 'singleRound', entryFeeCents: 0, prizeType: 'cashPurse',
    divisionMode: 'both', doubleDipRule: 'onePrizePerPlayer', entryIds: ['n1'],
    minEntries: 1, maxEntries: 4,
    registrationOpens: Timestamp.now(), registrationCloses: Timestamp.now(),
    eligibility: {}, payoutTable: [], roundDeadlineDays: 7,
  });
  await db.doc('entries/n1').set({
    tournamentId: tid5, userIds: ['p2'], teamId: null, teamName: null, captainId: 'p2',
    combinedIndex: 12.4, flight: null, seed: 1, paymentIntentId: null,
    paymentStatus: 'captured', status: 'active',
  });
  // 95% allowance: CH = 12.4×(130/113) + (72.5−71) = 15.766; ×0.95 = 14.98 → 15
  await createScorecards(tid5, [{ id: 'n1', userIds: ['p2'], combinedIndex: 12.4 }], 1, ['netCourse'], 0.95);
  const sc = (await db.doc(`scorecards/${tid5}_n1_1`).get()).data();
  check('playing handicap frozen at draw (15)', sc.courseHandicap === 15, sc.courseHandicap);

  await call(fns.submitRoundScore, 'p2', { tournamentId: tid5, round: 1, gross: 88 });
  const sc2 = (await db.doc(`scorecards/${tid5}_n1_1`).get()).data();
  check('net computed on submission (88 − 15 = 73)', sc2.net === 73, sc2.net);

  // Gross format: allowance null → courseHandicap null → net stays null.
  await createScorecards('grossRules1', [{ id: 'g1', userIds: ['p1'], combinedIndex: 7.1 }], 1, ['netCourse'], null);
  const gsc = (await db.doc('scorecards/grossRules1_g1_1').get()).data();
  check('gross format: no strokes even at a rated course', gsc.courseHandicap === null);

  // ================= FLOW G2 — scramble 35/15 + scratch + DNF ===============
  console.log('\nFLOW G2 — team allowance (35/15), explicit scratch, DNF sweep');
  // 14+19 pair at netCourse (slope 130, rating 72.5, par 71):
  //   CH_low  = 14×130/113 + 1.5 = 17.606
  //   CH_high = 19×130/113 + 1.5 = 23.358
  //   0.35×17.606 + 0.15×23.358 = 9.67 → 10 strokes. The per-player indexes
  // matter: a "combined 33" made of 5+28 would get a DIFFERENT number.
  await createScorecards(
    'scr1',
    [{ id: 's1', userIds: ['p2', 'p3'], combinedIndex: 33, indexes: [14, 19] }],
    1, ['netCourse'], { type: 'scramble2', low: 0.35, high: 0.15 },
  );
  const scr = (await db.doc('scorecards/scr1_s1_1').get()).data();
  check('scramble2: 14+19 team plays off 10 (35/15 of real CHs)', scr.courseHandicap === 10, scr.courseHandicap);

  await createScorecards(
    'scr2',
    [{ id: 's2', userIds: ['p1', 'p4'], combinedIndex: 11.3, indexes: [4.2, 7.1] }],
    1, ['netCourse'], { type: 'scramble2', low: 0.35, high: 0.15 },
  );
  const scr2 = (await db.doc('scorecards/scr2_s2_1').get()).data();
  check('scramble2: 4.2+7.1 team plays off 4 — a real 6-stroke equalizer', scr2.courseHandicap === 4, scr2.courseHandicap);

  // Explicit scratch ({type:'none'}) → no strokes even at a rated course.
  await createScorecards('scr3', [{ id: 's3', userIds: ['p1'], combinedIndex: 7.1, indexes: [7.1] }], 1, ['netCourse'], { type: 'none' });
  const scr3 = (await db.doc('scorecards/scr3_s3_1').get()).data();
  check('explicit scratch spec: courseHandicap null', scr3.courseHandicap === null);

  // DNF sweep: a card past dueAt closes as dnf instead of freezing completion.
  const { dnfSweep } = require(path + '/lib/scheduled.js');
  await db.doc('scorecards/dnfT_e9_1').set({
    tournamentId: 'dnfT', entryId: 'e9', userId: 'p3', round: 1, placeId: '',
    gross: 0, courseHandicap: null, net: null, holes: null, submittedBy: null,
    confirmedBy: null, confirmDeadline: null,
    dueAt: Timestamp.fromMillis(Date.now() - 1000),
    scorecardPhotoUrl: null, status: 'awaitingResult',
  });
  await dnfSweep(Date.now());
  const dnfCard = (await db.doc('scorecards/dnfT_e9_1').get()).data();
  check('overdue card closes as DNF (no frozen seasons)', dnfCard.status === 'dnf', dnfCard.status);

  // ================= FLOW I — the league machine ============================
  console.log('\nFLOW I — league season: auto-created weekly stops, rotating courses');
  const { tourSweep } = require(path + '/lib/tour.js');
  const wk1 = Date.now() + 2 * 86_400_000;
  const { seriesId } = await call(fns.createTourSeries, 'org1', {
    name: 'KC Tuesday League',
    season: '2026 Summer',
    schedule: {
      firstStartAt: wk1,
      weeks: 3,
      countBest: 2,
      entryFeeCents: 0, // free season — no paid-market gate needed in test
      maxEntries: 24,
      placeIds: ['netCourse', 'promoteMe'], // rotation: wk1 net, wk2 promote, wk3 net
      flights: [{ min: 0, max: 9 }, { min: 9.1, max: 54 }],
    },
  });
  check('series created with schedule', !!seriesId);
  const stops1 = await db.collection('tourStops').where('seriesId', '==', seriesId).get();
  check('week 1 stop exists immediately', stops1.size === 1 && stops1.docs[0].data().weekNumber === 1);
  check('week 1 plays the first rotation course', stops1.docs[0].data().placeId === 'netCourse');

  // Sweep just inside the 6-day lead window before week 2 → creates week 2.
  await tourSweep(wk1 + 7 * 86_400_000 - 5 * 86_400_000);
  const stops2 = await db.collection('tourStops').where('seriesId', '==', seriesId).get();
  const wk2stop = stops2.docs.map((d) => d.data()).find((s) => s.weekNumber === 2);
  check('sweep auto-created week 2', stops2.size === 2 && !!wk2stop);
  check('week 2 rotates to the second course', wk2stop?.placeId === 'promoteMe');
  // Sweep again at the same instant: week 3 is still outside the lead window.
  await tourSweep(wk1 + 7 * 86_400_000 - 5 * 86_400_000);
  const stops3 = await db.collection('tourStops').where('seriesId', '==', seriesId).get();
  check('sweep is idempotent inside the window', stops3.size === 2);
  const wk2t = (await db.doc(`tournaments/${wk2stop.tournamentId}`).get()).data();
  check('stop fee is configurable, not 25%-hardcoded', wk2t.adminFeePercent === 0, wk2t.adminFeePercent);

  // ================= FLOW J — instant net event (mixed crew) ================
  console.log('\nFLOW J — net-capable instant event: mixed crew, day-one entry');
  await db.doc('eventTemplates/netClassic').set({
    marketId: 'kc', name: 'Net Classic', formatId: 'grossFoursome',
    fieldSize: 8, fieldSizeMin: 4, entryFeeMinCents: 2000, entryFeeMaxCents: 10000,
    allowedPayoutShapes: ['70_30'], adminFeePercent: 10, requiresGhinAboveCents: 7500,
    netCapable: true, netAllowancePercent: 0.9, active: true,
  });
  // A brand-new, self-declared crew member (0 events, account made just now).
  await db.doc('users/crew1').set({
    marketId: 'kc', displayName: 'Fresh, Guy', photoUrl: null, age: 30, gender: 'other',
    handicap: { index: 21.0, source: 'self', ghinNumber: null, sourceUrl: null, verifiedAt: null, verifiedBy: null },
    role: 'member', organizerMarkets: [], canCreatePaidEvents: false,
    createdAt: Timestamp.now(), status: 'active', areas: [],
  });
  const instEvt = await call(fns.createInstantEvent, 'crew1', {
    templateId: 'netClassic', placeId: null, startsAt: Date.now() + 3 * 86400000,
    entryFeeCents: 2000, payoutShape: '70_30',
  });
  const instT = (await db.doc(`tournaments/${instEvt.tournamentId}`).get()).data();
  check('net instant event has both divisions', instT.divisionMode === 'both', instT.divisionMode);
  check('payout table carries gross AND net rows',
    instT.payoutTable.some((r) => r.division === 'gross') && instT.payoutTable.some((r) => r.division === 'net'));
  check('net allowance override stored', instT.handicapAllowanceOverride && instT.handicapAllowanceOverride.percent === 0.9);
  check('low-stakes tier drops the 14-day wall', instT.eligibility.minAccountAgeDays === 0, instT.eligibility.minAccountAgeDays);
  check('low-stakes net allows self-declared index', instT.eligibility.requiresVerifiedIndex === false);
  // The fresh self-declared 21 clears the ELIGIBILITY gate (Stripe is off in
  // tests, so a paid entry stops at the payment rail — reaching it proves the
  // apprenticeship/verification gate let him through).
  let eligPassed = false;
  try {
    await call(fns.enterTournament, 'crew1', { tournamentId: instEvt.tournamentId });
    eligPassed = true;
  } catch (e) {
    eligPassed = /payments are not configured/i.test(e.message);
  }
  check('brand-new self-declared crew member clears the entry gate', eligPassed);
  // Ratingless net: no course rating on file → net = round(index × 0.9).
  await createScorecards('netInstant1', [{ id: 'ni1', userIds: ['crew1'], combinedIndex: 21.0, indexes: [21.0] }],
    1, [], { percent: 0.9, ratinglessOk: true });
  const niCard = (await db.doc('scorecards/netInstant1_ni1_1').get()).data();
  check('ratingless net: 21 index → 19 strokes (round(21×0.9))', niCard.courseHandicap === 19, niCard.courseHandicap);

  // ================= FLOW K — flights: plus index → TOP flight ===============
  console.log('\nFLOW K — flight assignment puts a plus index in the top flight');
  const flightT = 'flightTest1';
  await db.doc(`tournaments/${flightT}`).set({
    marketId: 'kc', formatId: 'grossFoursome', createdBy: 'org1', name: 'Flight Test',
    status: 'open', structure: 'singleRound', entryFeeCents: 0, prizeType: 'cashPurse',
    divisionMode: 'grossOnly', doubleDipRule: 'onePrizePerPlayer', payoutTable: [],
    minEntries: 8, maxEntries: 8, registrationOpens: Timestamp.now(),
    registrationCloses: Timestamp.fromMillis(Date.now() + 3600000),
    eligibility: {}, roundDeadlineDays: 7, entryIds: [],
  });
  // 8 entrants incl. a +2.0 (stored -2.0) plus indexes 6..24.
  const flightIdx = [-2.0, 6, 9, 12, 15, 18, 21, 24];
  const fEntries = [];
  for (let i = 0; i < flightIdx.length; i++) {
    const eid = `fe${i}`;
    await db.doc(`entries/${eid}`).set({
      tournamentId: flightT, userIds: [`fu${i}`], teamId: null, teamName: null,
      captainId: `fu${i}`, combinedIndex: flightIdx[i], indexes: [flightIdx[i]],
      flight: null, seed: 0, paymentIntentId: null, paymentStatus: 'captured', status: 'active',
    });
    await db.doc(`tournaments/${flightT}`).update({ entryIds: admin.firestore.FieldValue.arrayUnion(eid) });
    fEntries.push(eid);
  }
  await call(fns.closeRegistration, 'org1', { tournamentId: flightT });
  const plusEntry = (await db.doc('entries/fe0').get()).data(); // the -2.0
  const worstEntry = (await db.doc('entries/fe7').get()).data(); // the 24
  check('plus index (-2.0) lands in the TOP flight (A)', plusEntry.flight === 'A', plusEntry.flight);
  check('the 24 lands in the bottom flight', worstEntry.flight !== 'A', worstEntry.flight);

  // ================= FLOW H — course data entry + promotion ==================
  console.log('\nFLOW H — course data entry (listed → supported)');
  await db.doc('courses/promoteMe').set({
    placeId: 'promoteMe', marketId: 'kc', name: 'Promote CC', address: '', location: null,
    tier: 'listed', accessType: 'public', guestPolicy: null, bookingPlatform: null,
    bookingUrl: null, bookingWindowDays: null, bookingOpensAtLocal: null,
    holeHandicapOrder: null, holePars: null, teeSets: null, roundCount: 5,
  });
  // member cannot enter course data
  let memberBlocked = false;
  try {
    await call(fns.updateCourseData, 'p1', { placeId: 'promoteMe', teeSets: [{ name: 'Blue', yardage: 6400, rating: 71.2, slope: 126, par: 71 }] });
  } catch { memberBlocked = true; }
  check('member cannot enter course data', memberBlocked);
  // bad stroke index rejected
  let badIndex = false;
  try {
    await call(fns.updateCourseData, 'org1', { placeId: 'promoteMe', holeHandicapOrder: Array(18).fill(1) });
  } catch { badIndex = true; }
  check('invalid stroke index rejected', badIndex);
  // full data promotes
  const promo = await call(fns.updateCourseData, 'org1', {
    placeId: 'promoteMe',
    teeSets: [
      { name: 'Blue', yardage: 6400, rating: 71.2, slope: 126, par: 71 },
      { name: 'White', yardage: 5900, rating: 68.9, slope: 118, par: 71 },
    ],
    holeHandicapOrder: [7,1,13,5,17,9,3,15,11,2,14,6,18,10,4,16,12,8],
  });
  check('full data promotes to supported', promo.promoted === true);
  const promoted = (await db.doc('courses/promoteMe').get()).data();
  check('tier is supported with 2 tee sets', promoted.tier === 'supported' && promoted.teeSets.length === 2);

  console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
