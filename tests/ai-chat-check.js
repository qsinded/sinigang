const assert = require('assert');
const handler = require('../api/chat');

function responseMock() {
  return {
    code: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

(async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  const oldModel = process.env.OPENAI_MODEL;
  const oldFetch = global.fetch;
  try {
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    process.env.OPENAI_MODEL = 'test-model';
    let upstreamBody;
    global.fetch = async (_url, options) => {
      upstreamBody = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ output_text: 'Try this concept in your own words.' }) };
    };
    const req = { method: 'POST', body: {
      question: 'Explain photosynthesis',
      documentName: 'biology.pdf',
      chunks: [
        { source: 'page 4', text: 'Photosynthesis converts light energy into chemical energy in plants.' },
        { source: 'page 8', text: 'Chlorophyll absorbs light.' }
      ],
      profile: { level: 'beginner', goal: 'exam', style: 'coach', weakTopics: ['photosynthesis'], understood: 2, review: 1 }
    } };
    const res = responseMock();
    await handler(req, res);
    assert.strictEqual(res.code, 200, 'valid request should succeed');
    assert.match(res.body.answer, /concept/);
    const systemText = upstreamBody.input.find(m => m.role === 'system').content;
    assert.match(systemText, /page 4/);
    assert.match(systemText, /Photosynthesis converts light energy/);
    assert.match(systemText, /"goal":"exam"/);
    assert.match(systemText, /photosynthesis/);

    const badRes = responseMock();
    await handler({ method: 'POST', body: { question: 'Explain this', chunks: [], documentText: '' } }, badRes);
    assert.strictEqual(badRes.code, 400, 'request without readable material should be rejected');
    console.log('AI chat checks passed');
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = oldModel;
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
