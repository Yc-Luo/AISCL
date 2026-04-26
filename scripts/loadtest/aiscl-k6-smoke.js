import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1').replace(/\/$/, '');
const TEST_EMAIL = __ENV.TEST_EMAIL || '';
const TEST_USERNAME = __ENV.TEST_USERNAME || '';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || '';
const PROJECT_ID = __ENV.PROJECT_ID || '';
const SCENARIO = __ENV.SCENARIO || 'pilot';
const INCLUDE_AI = (__ENV.INCLUDE_AI || 'false').toLowerCase() === 'true';
const AI_PROBABILITY = Number(__ENV.AI_PROBABILITY || '0.03');

const profiles = {
  smoke: [
    { duration: '30s', target: 3 },
    { duration: '30s', target: 0 },
  ],
  pilot: [
    { duration: '1m', target: 10 },
    { duration: '3m', target: 30 },
    { duration: '1m', target: 0 },
  ],
  class: [
    { duration: '2m', target: 30 },
    { duration: '8m', target: 60 },
    { duration: '2m', target: 0 },
  ],
  limit: [
    { duration: '2m', target: 50 },
    { duration: '10m', target: 100 },
    { duration: '2m', target: 0 },
  ],
};

export const options = {
  stages: profiles[SCENARIO] || profiles.pilot,
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500'],
    checks: ['rate>0.98'],
    api_5xx_rate: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const api5xxRate = new Rate('api_5xx_rate');

function authHeaders(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}

function recordServerError(res) {
  api5xxRate.add(res.status >= 500);
}

function checkCore(res, label) {
  recordServerError(res);
  check(res, {
    [`${label}: status is 200`]: (r) => r.status === 200,
  });
}

function checkOptionalRead(res, label) {
  recordServerError(res);
  check(res, {
    [`${label}: no server error`]: (r) => r.status < 500,
  });
}

function parseToken(loginRes) {
  try {
    return loginRes.json('access_token');
  } catch (error) {
    return null;
  }
}

function resolveProjectId(projectsRes) {
  if (PROJECT_ID) {
    return PROJECT_ID;
  }
  try {
    return projectsRes.json('projects.0.id');
  } catch (error) {
    return null;
  }
}

export function setup() {
  if (!TEST_PASSWORD || (!TEST_EMAIL && !TEST_USERNAME)) {
    fail('Set TEST_EMAIL or TEST_USERNAME, and TEST_PASSWORD before running the load test.');
  }

  const loginPayload = TEST_EMAIL
    ? { email: TEST_EMAIL, password: TEST_PASSWORD }
    : { username: TEST_USERNAME, password: TEST_PASSWORD };

  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify(loginPayload),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(loginRes, {
    'login: status is 200': (r) => r.status === 200,
    'login: token returned': (r) => Boolean(parseToken(r)),
  });

  const token = parseToken(loginRes);
  if (!token) {
    fail(`Login failed. status=${loginRes.status}, body=${loginRes.body}`);
  }

  const projectsRes = http.get(`${BASE_URL}/api/v1/projects?limit=20`, authHeaders(token));
  checkCore(projectsRes, 'projects list');

  const projectId = resolveProjectId(projectsRes);
  if (!projectId) {
    fail('No accessible project found. Set PROJECT_ID explicitly or use an account that belongs to a project.');
  }

  return { token, projectId };
}

export default function (data) {
  const headers = authHeaders(data.token);
  const projectId = data.projectId;

  checkOptionalRead(http.get(`${BASE_URL}/health`), 'health');
  checkCore(http.get(`${BASE_URL}/api/v1/projects?limit=20`, headers), 'projects list');
  checkCore(http.get(`${BASE_URL}/api/v1/projects/${projectId}`, headers), 'project detail');
  checkCore(
    http.get(`${BASE_URL}/api/v1/chat/projects/${projectId}/messages?limit=50`, headers),
    'chat history',
  );
  checkCore(
    http.get(`${BASE_URL}/api/v1/documents/projects/${projectId}?limit=20`, headers),
    'documents',
  );
  checkCore(
    http.get(`${BASE_URL}/api/v1/wiki/projects/${projectId}/items?limit=20`, headers),
    'wiki items',
  );
  checkCore(
    http.get(`${BASE_URL}/api/v1/analytics/projects/${projectId}/dashboard`, headers),
    'student dashboard',
  );
  checkOptionalRead(
    http.get(`${BASE_URL}/api/v1/collaboration/projects/${projectId}/snapshot`, headers),
    'collaboration snapshot',
  );
  checkOptionalRead(
    http.get(`${BASE_URL}/api/v1/inquiry/projects/${projectId}/snapshot`, headers),
    'inquiry snapshot',
  );

  if (INCLUDE_AI && Math.random() < AI_PROBABILITY) {
    const aiPayload = {
      project_id: projectId,
      role_id: 'default-tutor',
      use_rag: false,
      message: '请用一句话说明当前小组下一步应该关注什么。',
      current_stage: '任务导入',
    };
    checkOptionalRead(
      http.post(`${BASE_URL}/api/v1/ai/chat`, JSON.stringify(aiPayload), headers),
      'optional ai chat',
    );
  }

  sleep(0.5 + Math.random() * 1.5);
}
