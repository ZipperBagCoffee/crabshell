'use strict';

const STATE_KEYS = Object.freeze([
  'installed',
  'activated',
  'trusted',
  'behavior-verified',
  'degraded',
  'drifted',
  'unsupported',
]);

function unique(items) {
  return [...new Set((items || []).filter(Boolean).map(String))];
}

function deriveSupportState(input = {}) {
  const unsupported = input.supported === false;
  const installed = input.installed === true;
  const activated = installed && input.activated === true;
  const trusted = activated && input.trusted === true;
  const behaviorVerified = activated && input.behaviorVerified === true;
  const driftReasons = unique(input.driftReasons);
  const degradedReasons = unique(input.degradedReasons);

  if (!unsupported && installed && !activated) degradedReasons.push('installed-but-not-activated');
  if (activated && input.trustRequired !== false && !trusted) degradedReasons.push('hook-trust-not-established');
  if (activated && !behaviorVerified) degradedReasons.push('behavior-probe-not-passed');
  for (const reason of driftReasons) degradedReasons.push(`drift:${reason}`);

  const drifted = installed && driftReasons.length > 0;
  const degraded = installed && unique(degradedReasons).length > 0;
  const states = {
    installed,
    activated,
    trusted,
    'behavior-verified': behaviorVerified,
    degraded,
    drifted,
    unsupported,
  };

  let status = 'not-installed';
  if (unsupported) status = 'unsupported';
  else if (drifted) status = 'drifted';
  else if (degraded) status = 'degraded';
  else if (behaviorVerified) status = 'behavior-verified';
  else if (trusted) status = 'trusted';
  else if (activated) status = 'activated';
  else if (installed) status = 'installed';

  return {
    status,
    states,
    reasons: {
      degraded: unique(degradedReasons),
      drifted: driftReasons,
      unsupported: unsupported ? unique(input.unsupportedReasons || ['host-probe-unavailable']) : [],
    },
    evidence: input.evidence || {},
  };
}

function codexAppState() {
  return {
    status: 'not-directly-exercised',
    directlyExercised: false,
    states: Object.fromEntries(STATE_KEYS.map(key => [key, false])),
    reasons: { degraded: [], drifted: [], unsupported: [] },
    evidence: { boundary: 'Codex CLI and app-server observations do not prove Codex desktop-app behavior.' },
  };
}

module.exports = { STATE_KEYS, codexAppState, deriveSupportState };
