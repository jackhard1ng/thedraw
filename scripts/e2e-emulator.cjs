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

  console.log(`\n========== ${pass} passed, ${fail} failed ==========`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
