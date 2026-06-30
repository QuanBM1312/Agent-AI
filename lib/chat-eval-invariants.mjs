export function normalizeForEvalMatch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function responseText(result) {
  const body = result.responseBody;

  if (typeof body === "string") {
    return body;
  }

  if (body && typeof body === "object") {
    const bodyText = [
      body.output,
      body.text,
      body.message,
      body.error,
    ]
      .filter((value) => typeof value === "string" && value.trim())
      .join("\n");

    return bodyText || result.bodySummary || "";
  }

  return result.bodySummary || "";
}

export function responseMeta(result) {
  const body = result.responseBody;

  if (body && typeof body === "object" && body._meta && typeof body._meta === "object") {
    return body._meta;
  }

  return {};
}

export function citations(result) {
  const body = result.responseBody;

  if (body && typeof body === "object" && Array.isArray(body.citations)) {
    return body.citations;
  }

  return [];
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function structuredEvidence(result) {
  const body = result.responseBody;
  const meta = responseMeta(result);
  const candidates = [
    citations(result),
    body && typeof body === "object" ? body.sources : null,
    body && typeof body === "object" ? body.evidence : null,
    body && typeof body === "object" ? body.sourceEvidence : null,
    meta.sources,
    meta.evidence,
    meta.sourceEvidence,
    meta.queryPlan?.sources,
    meta.queryPlan?.evidence,
  ];

  return candidates.some(nonEmptyArray);
}

function matcherLabel(matcher) {
  if (matcher instanceof RegExp) {
    return matcher.toString();
  }

  return String(matcher);
}

export function matchesEvalSignal(text, matcher) {
  if (matcher instanceof RegExp) {
    return matcher.test(text) || matcher.test(normalizeForEvalMatch(text));
  }

  return normalizeForEvalMatch(text).includes(normalizeForEvalMatch(matcher));
}

function matchesAllSignals(text, signals = []) {
  return signals.every((signal) => matchesEvalSignal(text, signal));
}

function matchesAnySignal(text, signals = []) {
  return signals.some((signal) => matchesEvalSignal(text, signal));
}

function matchesWarningGroups(text, groups = []) {
  return groups.every((group) => {
    const candidates = Array.isArray(group) ? group : [group];
    return matchesAnySignal(text, candidates);
  });
}

function describeWarningGroups(groups = []) {
  return groups
    .map((group) => {
      const candidates = Array.isArray(group) ? group : [group];
      return `[${candidates.map(matcherLabel).join(" | ")}]`;
    })
    .join(", ");
}

export function webWasUsed(result) {
  const meta = responseMeta(result);
  const routeHint = normalizeForEvalMatch(routeHintFor(result));
  const provider = normalizeForEvalMatch(meta.webSearchProvider);

  return (
    meta.webSearchUsed === true ||
    routeHint.includes("web_search") ||
    routeHint.includes("web_offer") ||
    provider.includes("google") ||
    provider.includes("web")
  );
}

function routeHintFor(result) {
  const body = result.responseBody;
  const meta = responseMeta(result);
  const candidates = [
    result.routeHint,
    meta.routeHint,
    meta.toolRoute,
    body && typeof body === "object" ? body.routeHint : null,
    body && typeof body === "object" ? body.toolRoute : null,
  ];

  return candidates.find((value) => typeof value === "string" && value.trim()) || "";
}

function routeMatches(routeHint, candidates = []) {
  if (!routeHint || candidates.length === 0) {
    return false;
  }

  return candidates.some((candidate) => {
    if (candidate instanceof RegExp) {
      return candidate.test(routeHint);
    }

    if (candidate.startsWith("/") && candidate.endsWith("/")) {
      return new RegExp(candidate.slice(1, -1)).test(routeHint);
    }

    return routeHint === candidate;
  });
}

function hasFormula(text) {
  const normalized = normalizeForEvalMatch(text);

  return (
    normalized.includes("cong thuc") ||
    normalized.includes("lai/lo =") ||
    normalized.includes("loi nhuan =") ||
    normalized.includes("doanh thu -") ||
    normalized.includes("doanh thu - chi phi") ||
    normalized.includes("doanh thu - gia von") ||
    normalized.includes("doanh thu tru") ||
    normalized.includes("doanh thu tru chi phi") ||
    normalized.includes("doanh thu tru gia von") ||
    /[a-z\u00c0-\u1ef9 ]+=.+[-+*/]/i.test(text)
  );
}

function hasSourceEvidence(result) {
  const normalized = normalizeForEvalMatch(responseText(result));

  return (
    structuredEvidence(result) ||
    normalized.includes("nguon du lieu") ||
    normalized.includes("nguon:") ||
    normalized.includes("file") ||
    normalized.includes("sheet") ||
    normalized.includes("database") ||
    normalized.includes("bang du lieu") ||
    normalized.includes("trich xuat") ||
    normalized.includes("du lieu noi bo")
  );
}

function exposedIntent(result) {
  const body = result.responseBody;
  const meta = responseMeta(result);
  const candidates = [
    meta.intent,
    meta.expectedIntent,
    meta.queryIntent,
    meta.queryPlan?.intent,
    body && typeof body === "object" ? body.intent : null,
    body && typeof body === "object" ? body.queryIntent : null,
    body && typeof body === "object" ? body.queryPlan?.intent : null,
  ];

  return candidates.find((value) => typeof value === "string" && value.trim()) || null;
}

function exposedVerificationStatus(result) {
  const body = result.responseBody;
  const meta = responseMeta(result);
  const candidates = [
    result.verificationStatus,
    meta.verificationStatus,
    meta.answerVerification?.status,
    body && typeof body === "object" ? body.verificationStatus : null,
    body && typeof body === "object" ? body.answerVerification?.status : null,
  ];

  return candidates.find((value) => typeof value === "string" && value.trim()) || null;
}

function countQuestions(text) {
  const explicitMarks = (text.match(/\?/g) || []).length;

  if (explicitMarks > 0) {
    return explicitMarks;
  }

  const normalized = normalizeForEvalMatch(text);
  const questionStarts = normalized.match(/\b(ai|cai gi|du lieu nao|file nao|hop dong nao|du an nao|bao nhieu|khi nao|o dau|vi sao|tai sao)\b/g);

  return questionStarts?.length || 0;
}

function responseTextWithWarnings(result) {
  const body = result.responseBody;
  const meta = responseMeta(result);
  const warnings = [
    body && typeof body === "object" && Array.isArray(body.warnings) ? body.warnings : [],
    Array.isArray(meta.warnings) ? meta.warnings : [],
  ].flat().filter((value) => typeof value === "string" && value.trim());

  return [responseText(result), ...warnings].join("\n");
}

function makeAssertion(name, passed, issueClass, message) {
  return { name, passed, class: issueClass, message };
}

function evaluateCondition(result, condition) {
  const text = responseText(result);
  const textWithWarnings = responseTextWithWarnings(result);
  const checks = [];

  if (condition.requiredFormula) {
    checks.push(hasFormula(text));
  }

  if (condition.requiredSource || condition.requiredEvidence) {
    checks.push(hasSourceEvidence(result));
  }

  if (Array.isArray(condition.requiredSignals) && condition.requiredSignals.length > 0) {
    checks.push(matchesAllSignals(text, condition.requiredSignals));
  }

  if (Array.isArray(condition.requiredWarningsAny) && condition.requiredWarningsAny.length > 0) {
    checks.push(matchesWarningGroups(textWithWarnings, condition.requiredWarningsAny));
  }

  if (Array.isArray(condition.mustNotContainAny) && condition.mustNotContainAny.length > 0) {
    checks.push(!matchesAnySignal(text, condition.mustNotContainAny));
  }

  return checks.length > 0 && checks.every(Boolean);
}

export function evaluateChatEvalCase(result, testCase) {
  const text = responseText(result);
  const textWithWarnings = responseTextWithWarnings(result);
  const assertions = [
    makeAssertion(
      "status_2xx",
      result.status >= 200 && result.status < 300,
      "tool",
      `Expected HTTP 2xx, got ${result.status}`,
    ),
  ];
  const pendingIntent =
    testCase.expectedIntent && !exposedIntent(result)
      ? {
          expected: testCase.expectedIntent,
          reason: "Response metadata does not expose planner intent yet",
        }
      : null;

  const intent = exposedIntent(result);
  if (testCase.expectedIntent && intent) {
    assertions.push(
      makeAssertion(
        "expected_intent",
        intent === testCase.expectedIntent,
        "routing",
        `Expected intent ${testCase.expectedIntent}, got ${intent}`,
      ),
    );
  }

  const allowedRoutes = testCase.allowedRoutes || testCase.expectedRoutes || [];
  const forbiddenRoutes = testCase.forbiddenRoutes || [];
  const routeHint = routeHintFor(result);

  if (allowedRoutes.length > 0) {
    assertions.push(
      makeAssertion(
        "route_allowed",
        Boolean(routeHint) && routeMatches(routeHint, allowedRoutes),
        "routing",
        `Route ${routeHint || "missing"} is not in allowed set: ${allowedRoutes.join(", ")}`,
      ),
    );
  }

  if (forbiddenRoutes.length > 0) {
    assertions.push(
      makeAssertion(
        "route_not_forbidden",
        !routeMatches(routeHint, forbiddenRoutes),
        "routing",
        `Route ${routeHint || "missing"} is forbidden for this case`,
      ),
    );
  }

  if (testCase.forbiddenWeb) {
    assertions.push(
      makeAssertion(
        "no_web_for_internal_prompt",
        !webWasUsed(result),
        "routing",
        "Internal business prompt used or offered a web route",
      ),
    );
  }

  if (Array.isArray(testCase.requiredSignals) && testCase.requiredSignals.length > 0) {
    assertions.push(
      makeAssertion(
        "required_signals_present",
        matchesAllSignals(text, testCase.requiredSignals),
        "evidence",
        `Missing required signal(s): ${testCase.requiredSignals.map(matcherLabel).join(", ")}`,
      ),
    );
  }

  const warningGroups =
    Array.isArray(testCase.requiredWarningsAny) && testCase.requiredWarningsAny.length > 0
      ? testCase.requiredWarningsAny
      : Array.isArray(testCase.requiredWarnings)
        ? testCase.requiredWarnings
        : [];

  if (warningGroups.length > 0) {
    assertions.push(
      makeAssertion(
        "required_warning_groups_present",
        matchesWarningGroups(textWithWarnings, warningGroups),
        "source-state",
        `Missing required warning group(s): ${describeWarningGroups(warningGroups)}`,
      ),
    );
  }

  const forbiddenSignals =
    Array.isArray(testCase.mustNotContainAny) && testCase.mustNotContainAny.length > 0
      ? testCase.mustNotContainAny
      : Array.isArray(testCase.mustNotContain)
        ? testCase.mustNotContain
        : [];

  if (forbiddenSignals.length > 0) {
    const forbiddenText = forbiddenSignals.filter((signal) =>
      matchesEvalSignal(text, signal),
    );
    assertions.push(
      makeAssertion(
        "forbidden_text_absent",
        forbiddenText.length === 0,
        "evidence",
        `Response contained forbidden text: ${forbiddenText.map(matcherLabel).join(", ")}`,
      ),
    );
  }

  if (testCase.requiredFormula) {
    assertions.push(
      makeAssertion(
        "formula_present",
        hasFormula(text),
        "evidence",
        "Calculation/business answer did not include a formula",
      ),
    );
  }

  if (testCase.requiredSource || testCase.requiredEvidence) {
    assertions.push(
      makeAssertion(
        "source_or_evidence_present",
        hasSourceEvidence(result),
        "evidence",
        "Verified answer did not include source/evidence",
      ),
    );
  }

  if (Array.isArray(testCase.alternativeAssertionGroups)) {
    for (const group of testCase.alternativeAssertionGroups) {
      assertions.push(
        makeAssertion(
          group.name || "alternative_assertion_group",
          Array.isArray(group.any) && group.any.some((condition) => evaluateCondition(result, condition)),
          group.class || "evidence",
          group.message || "None of the alternative assertion branches passed",
        ),
      );
    }
  }

  const verificationStatus = exposedVerificationStatus(result);
  const requiredVerificationStatuses =
    typeof testCase.requiredVerificationStatus === "string"
      ? [testCase.requiredVerificationStatus]
      : Array.isArray(testCase.requiredVerificationStatus)
        ? testCase.requiredVerificationStatus
        : [];

  if (requiredVerificationStatuses.length > 0) {
    assertions.push(
      makeAssertion(
        "verification_status_present",
        Boolean(verificationStatus) && requiredVerificationStatuses.includes(verificationStatus),
        "ui",
        `Expected verification status ${requiredVerificationStatuses.join(" or ")}, got ${verificationStatus || "missing"}`,
      ),
    );
  }

  if (Number.isInteger(testCase.maxQuestions)) {
    const questionCount = countQuestions(text);
    assertions.push(
      makeAssertion(
        "question_count_within_limit",
        questionCount <= testCase.maxQuestions,
        "evidence",
        `Expected at most ${testCase.maxQuestions} question(s), got ${questionCount}`,
      ),
    );
  }

  if (Array.isArray(testCase.requiredUiSignals) && testCase.requiredUiSignals.length > 0) {
    assertions.push(
      makeAssertion(
        "required_ui_signals_present",
        matchesAllSignals(text, testCase.requiredUiSignals),
        "ui",
        `Missing required UI signal(s): ${testCase.requiredUiSignals.map(matcherLabel).join(", ")}`,
      ),
    );
  }

  if (assertions.length === 1) {
    assertions.push(
      makeAssertion(
        "response_has_content",
        responseText(result).trim().length > 0,
        "evidence",
        "Legacy smoke case returned no answer content",
      ),
    );
  }

  const qualityPassed = assertions.every((assertion) => assertion.passed);

  return {
    ...result,
    ok: qualityPassed,
    qualityPassed,
    assertions,
    pendingIntent,
    exposedIntent: intent,
    exposedVerificationStatus: verificationStatus,
    failureClasses: [
      ...new Set(assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.class)),
    ],
  };
}

export function addEquivalentGroupAssertions(results, cases) {
  const groups = cases.reduce((acc, testCase) => {
    if (!testCase.equivalentGroup) {
      return acc;
    }

    acc[testCase.equivalentGroup] = acc[testCase.equivalentGroup] || [];
    acc[testCase.equivalentGroup].push(testCase.id);
    return acc;
  }, {});

  const byId = new Map(results.map((result) => [result.id, result]));

  for (const [groupName, ids] of Object.entries(groups)) {
    const groupResults = ids.map((id) => byId.get(id)).filter(Boolean);

    if (groupResults.length < 2) {
      continue;
    }

    const routeSet = new Set(groupResults.map((result) => routeHintFor(result) || "missing"));
    const webSet = new Set(groupResults.map((result) => String(webWasUsed(result))));
    const allPassedSignals = groupResults.every((result) =>
      result.assertions
        .filter((assertion) => assertion.name === "required_signals_present")
        .every((assertion) => assertion.passed),
    );
    const passed = routeSet.size === 1 && webSet.size === 1 && !webSet.has("true") && allPassedSignals;
    const assertion = makeAssertion(
      `equivalent_group_${groupName}`,
      passed,
      "routing",
      `Equivalent prompts should have the same route, same no-web behavior, and required signals: ${ids.join(", ")}`,
    );

    for (const result of groupResults) {
      result.assertions.push(assertion);
      result.qualityPassed = result.assertions.every((item) => item.passed);
      result.ok = result.qualityPassed;
      result.failureClasses = [
        ...new Set(result.assertions.filter((item) => !item.passed).map((item) => item.class)),
      ];
    }
  }

  return results;
}
