// Every setting the KPI dashboard reads from Netlify environment variables, in one place.
// Defaults are A2Z's own GHL ids, so only secrets and keys need setting.
const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const lower = v => list(v).map(s => s.toLowerCase());
const int = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export const OWNER_EMAIL = 'jesse@a2zcs.net';
export const DEFAULT_LOCATION_ID = 'QUcu2PEAxPV1sQm1GQCq';

export function config(env = process.env) {
  return {
    timeZone: env.DASHBOARD_TIMEZONE || 'America/Los_Angeles',
    locationId: env.GHL_LOCATION_ID || DEFAULT_LOCATION_ID,
    ghlToken: env.GHL_API_TOKEN || env.GHL_PIT_TOKEN || '',
    ghlAppUrl: (env.GHL_APP_URL || 'https://app.gohighlevel.com').replace(/\/+$/, ''),
    pipelines: {
      demo: env.DEMO_PIPELINE_ID || 'd5Ix1SlN3YpZ5gQewZUo',
      labor: env.LABOR_PIPELINE_ID || 'RAP4Cqc1jKRTHaakYTL4',
      containers: env.CONTAINER_PIPELINE_ID || 'F8i8hB7E5xHrJbJUXFr4',
      changeOrders: env.CHANGE_ORDER_PIPELINE_ID || 'Nvk3EKhRzg5omo4BLCOK',
      hiring: env.HIRING_PIPELINE_ID || 'VMYXilFR93XJEgprCi7j'
    },
    // Stages the dispatch board shows as active jobs (same defaults as the board); change orders = any won.
    boardStageIds: list(env.BOARD_STAGE_IDS || 'b3ba7011-5b50-48b1-986d-fed4281289f6,6cfb3e15-0954-4f94-9f27-29f8f45b185d,bb901617-1ec6-4f3c-8c77-27ccafb96404,d0817d3b-89c1-49e5-bdfc-b362ee10f830'),
    // Stage names that mean "estimate sent" (matched case-insensitively, ignoring punctuation).
    proposalStageNames: lower(env.PROPOSAL_STAGE_NAMES || 'Proposal Sent,Change Order Sent'),
    // Contact type values. Customer = any of these; laborer = the labor pool / hiring.
    customerTypes: lower(env.CUSTOMER_CONTACT_TYPES || 'General-contractor,Developer,Home-owner'),
    laborerTypes: lower(env.LABORER_CONTACT_TYPES || 'Laborer'),
    contactTypeFieldId: env.CONTACT_TYPE_FIELD_ID || '',
    temperatureFieldId: env.GHL_TEMPERATURE_FIELD_ID || 'xOi9gCcAt2UvgA6POHMB',
    // Laborer temperature: these count as hired / active; cold = dormant.
    activeTemps: lower(env.ACTIVE_TEMPERATURES || 'Warm,Hot,VIP'),
    dormantTemps: lower(env.DORMANT_TEMPERATURES || 'Cold'),
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || '',
      authToken: env.TWILIO_AUTH_TOKEN || '',
      apiKeySid: env.TWILIO_API_KEY_SID || '',
      apiKeySecret: env.TWILIO_API_KEY_SECRET || '',
      numbers: list(env.TWILIO_NUMBERS),
      historyDays: int(env.TWILIO_HISTORY_DAYS, 400),
      answerMinSeconds: int(env.TWILIO_ANSWER_MIN_SECONDS, 20)
    },
    dispatch: { url: (env.DISPATCH_URL || '').replace(/\/+$/, ''), key: env.DISPATCH_EXPORT_KEY || '' },
    ledger: { url: (env.LEDGER_URL || '').replace(/\/+$/, ''), key: env.LEDGER_EXPORT_KEY || '' },
    responseLookbackDays: int(env.RESPONSE_LOOKBACK_DAYS, 120),
    conversationLookupsPerRun: int(env.CONVERSATION_LOOKUPS_PER_RUN, 150),
    syncIntervalMinutes: int(env.SYNC_INTERVAL_MINUTES, 30),
    offHoursIntervalMinutes: int(env.OFF_HOURS_SYNC_MINUTES, 120),
    contactsFullSyncHours: int(env.CONTACTS_FULL_SYNC_HOURS, 6),
    syncSecret: env.SYNC_SECRET || '',
    webhookSecret: env.GHL_WEBHOOK_SECRET || '',
    sessionSecret: env.SESSION_SECRET || '',
    appSharedSecret: env.GHL_APP_SHARED_SECRET || '',
    pin: env.DASHBOARD_PIN || '',
    owners: [...new Set([OWNER_EMAIL, ...lower(env.DASHBOARD_OWNERS)])],
    viewers: lower(env.DASHBOARD_VIEWERS)
  };
}

// Defaults for the settings an owner can change on the dashboard (stored in Blobs).
export const DEFAULT_SETTINGS = {
  containerFleet: { '10 Yard': 0, '20 Yard': 0, '30 Yard': 0, '40 Yard': 0 },
  rentalDays: 7,
  followUpDays: 3,
  estimateDays: 3,
  workdays: [1, 2, 3, 4, 5, 6],
  businessHours: { open: '07:00', close: '17:00' }
};
export function cleanSettings(input = {}) {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (input.containerFleet && typeof input.containerFleet === 'object') {
    out.containerFleet = {};
    for (const [k, v] of Object.entries(input.containerFleet)) {
      const name = String(k).trim().slice(0, 30); const n = Math.floor(Number(v));
      if (name && Number.isFinite(n) && n >= 0 && n <= 10000) out.containerFleet[name] = n;
    }
  }
  const n = (v, lo, hi, d) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
  out.rentalDays = n(input.rentalDays, 1, 365, out.rentalDays);
  out.followUpDays = n(input.followUpDays, 1, 60, out.followUpDays);
  out.estimateDays = n(input.estimateDays, 1, 30, out.estimateDays);
  if (Array.isArray(input.workdays)) { const w = [...new Set(input.workdays.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort(); if (w.length) out.workdays = w; }
  const hm = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
  if (input.businessHours && hm(input.businessHours.open) && hm(input.businessHours.close) && input.businessHours.open < input.businessHours.close) out.businessHours = { open: input.businessHours.open, close: input.businessHours.close };
  return out;
}
