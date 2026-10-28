import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function sendJson(res, statusCode, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function cleanApiKey(key) {
  if (typeof key !== 'string') return '';
  return key.trim().replace(/^["']+|["']+$/g, '').trim();
}

function resolveCredentials(config = {}) {
  let apiUrl = config.apiUrl || 'https://gem.onarous.ru';
  let apiKey = config.apiKey || '';

  if (!apiKey) {
    if (process.env.LOCALANTIGRAVITY_API_KEY) {
      apiKey = process.env.LOCALANTIGRAVITY_API_KEY;
    } else {
      try {
        const credFile = join(homedir(), '.dsh', '.credentials.yaml');
        if (existsSync(credFile)) {
          const content = readFileSync(credFile, 'utf8');
          const m = content.match(/LOCALANTIGRAVITY_API_KEY:\s*([^\r\n]+)/);
          if (m) apiKey = m[1];
        }
      } catch {}
    }
  }

  apiKey = cleanApiKey(apiKey);
  apiUrl = apiUrl.replace(/\/+$/, '');
  return { apiUrl, apiKey };
}

function positiveInteger(value, fallback, name, maximum) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }
  return resolved;
}

function finiteNumber(value, name, minimum, maximum) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}.`);
  }
  return value;
}

function nonEmptyString(value, fallback, name) {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== 'string' || !resolved.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return resolved.trim();
}

function taskErrorMessage(status, body) {
  if (body && typeof body === 'object') {
    const nested = body.error;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
    if (nested && typeof nested === 'object' && typeof nested.message === 'string') {
      return nested.message;
    }
  }
  return `GeminApi returned HTTP ${status}.`;
}

export function createParallelTaskTool(config = {}) {
  const defaultModel = config.taskModel || 'claude-sonnet-5-5-medium';
  const defaultMaxSubtasks = positiveInteger(config.taskMaxSubtasks, 5, 'taskMaxSubtasks', 16);
  const defaultMaxTokens = positiveInteger(config.taskMaxTokens, 32768, 'taskMaxTokens', 1000000);
  const defaultRouteSimple = config.routeSimpleToGemini !== false;
  const timeoutMs = positiveInteger(config.taskTimeoutMs, 600000, 'taskTimeoutMs', 1800000);

  return {
    name: 'parallel_task',
    description: 'Delegate one complex final goal to GeminApi for automatic planning, parallel execution, and final synthesis. Inherit the calling session model. Gemini callers use Gemini for every phase and cannot switch to Claude. Claude and Gemini 4 Argon callers keep complex work and synthesis on their primary model and route simple work to Gemini 3.8 Flash. Use this for at least two independent parts; pass the complete goal without pre-splitting.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        task: {
          type: 'string',
          description: 'The complete original goal, including all requirements and acceptance criteria.'
        },
        instructions: {
          type: 'string',
          description: 'Optional constraints that every worker and the final synthesizer must follow.'
        },
        model: {
          type: 'string',
          description: `Optional primary model. Defaults to the calling session model, or ${defaultModel} for calls without an agent. Gemini callers may select only Gemini models.`
        },
        max_subtasks: {
          type: 'integer',
          description: `Maximum automatically planned subtasks from 1 to 16. Defaults to ${defaultMaxSubtasks}.`
        },
        route_simple_to_gemini: {
          type: 'boolean',
          description: `Route straightforward subtasks to Gemini 3.8 Flash while retaining Claude or Gemini 4 Argon for complex work. Defaults to ${defaultRouteSimple}.`
        },
        simple_model: {
          type: 'string',
          description: 'Optional exact Gemini model ID. Omit to let GeminApi select the best available Flash Medium model.'
        },
        temperature: {
          type: 'number',
          description: 'Optional sampling temperature from 0 to 2.'
        },
        top_p: {
          type: 'number',
          description: 'Optional nucleus sampling value from 0 to 1.'
        },
        max_tokens: {
          type: 'integer',
          description: `Output-token budget shared with model reasoning. Defaults to ${defaultMaxTokens}.`
        }
      },
      required: ['task']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          status: { type: 'string' },
          model: { type: 'string' },
          output: { type: 'string' },
          plan: { type: 'object', additionalProperties: true },
          steps: { type: 'array', items: { type: 'object', additionalProperties: true } },
          orchestration: { type: 'object', additionalProperties: true },
          usage: { type: 'object', additionalProperties: true }
        },
        required: ['id', 'status', 'model', 'output', 'plan', 'steps', 'orchestration']
      },
      render: (_args, value) => [{ type: 'text', text: value.output }]
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new Error('parallel_task arguments must be an object.');
      }

      const task = nonEmptyString(args.task, undefined, 'task');
      // The persisted header identifies the model that produced this tool call,
      // even if the user switches the picker while execution is in flight.
      const callerModel = exec?.agent?.session?.requestHeader?.()?.config?.model;
      if (exec?.agent && (typeof callerModel !== 'string' || !callerModel.trim())) {
        throw new Error('Cannot resolve the calling session model for parallel_task.');
      }
      const model = nonEmptyString(args.model, callerModel || defaultModel, 'model');
      const geminiCaller = callerModel?.trim().toLowerCase().startsWith('gemini-');
      if (geminiCaller && !model.toLowerCase().startsWith('gemini-')) {
        throw new Error('Gemini sessions can run parallel_task only with Gemini models.');
      }
      const maxSubtasks = positiveInteger(args.max_subtasks, defaultMaxSubtasks, 'max_subtasks', 16);
      let routeSimple = args.route_simple_to_gemini === undefined
        ? defaultRouteSimple
        : args.route_simple_to_gemini;
      if (typeof routeSimple !== 'boolean') {
        throw new Error('route_simple_to_gemini must be a boolean.');
      }
      const isArgon = model.toLowerCase().includes('argon');
      if (model.toLowerCase().startsWith('gemini-') && !isArgon) routeSimple = false;

      const payload = {
        model,
        task,
        max_subtasks: maxSubtasks,
        route_simple_to_gemini: routeSimple,
        max_tokens: positiveInteger(args.max_tokens, defaultMaxTokens, 'max_tokens', 1000000)
      };
      if (args.instructions !== undefined) {
        payload.instructions = nonEmptyString(args.instructions, undefined, 'instructions');
      }
      if (args.simple_model !== undefined) {
        const simpleModel = nonEmptyString(args.simple_model, undefined, 'simple_model');
        if (!simpleModel.toLowerCase().startsWith('gemini-')) {
          throw new Error('simple_model must be a Gemini model ID.');
        }
        if (!routeSimple) {
          throw new Error('simple_model requires route_simple_to_gemini=true.');
        }
        payload.simple_model = simpleModel;
      }
      const temperature = finiteNumber(args.temperature, 'temperature', 0, 2);
      if (temperature !== undefined) payload.temperature = temperature;
      const topP = finiteNumber(args.top_p, 'top_p', 0, 1);
      if (topP !== undefined) payload.top_p = topP;
      const { apiUrl, apiKey } = resolveCredentials(config);
      if (!apiKey) {
        throw new Error('GeminApi API key is not configured. Set LOCALANTIGRAVITY_API_KEY in DSH credentials.');
      }

      const response = await fetch(`${apiUrl}/v1/tasks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: exec?.signal
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`GeminApi returned HTTP ${response.status} with invalid JSON.`);
      }
      if (!response.ok) {
        throw new Error(taskErrorMessage(response.status, result));
      }
      if (!result || result.status !== 'completed' || typeof result.output !== 'string') {
        throw new Error('GeminApi returned an invalid task result.');
      }
      return result;
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Parallel GeminApi task',
      kind: 'execute',
      rawInput: typeof args?.task === 'string' ? args.task : undefined
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? 'Parallel task failed' : 'Parallel task completed',
      kind: result.isError ? 'error' : 'execute',
      content: result.content
    })
  };
}

export function createDshSubagentTool(subagents, config = {}, toolsService = null) {
  const simpleModel = nonEmptyString(config.subagentSimpleModel, 'gemini-3.8-flash-medium', 'subagentSimpleModel');
  if (!simpleModel.startsWith('gemini-')) throw new Error('subagentSimpleModel must be Gemini.');
  return {
    name: 'dsh_subagent',
    description: 'Start a real background DSH subagent with local files, commands and inherited permissions. Fresh conversation: provide complete context, scope, file ownership and acceptance criteria. Launch independent tasks together and continue useful work while children run. Completion is delivered automatically; use list_agents and send_message for coordination. Simple Claude and Gemini 4 Argon tasks route to Gemini 3.8 Flash; complex tasks inherit the parent. Gemini never escalates to Claude. Do not delegate dependent steps or concurrent edits to the same files.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        description: { type: 'string', description: 'Short label for the child task.' },
        prompt: { type: 'string', description: 'Self-contained task with constraints and owned files; state read-only when appropriate.' },
        complexity: { type: 'string', enum: ['simple', 'complex'], description: 'Simple: bounded inspection, documentation or mechanical changes. Complex (default): architecture, debugging or risky code.' }
      },
      required: ['description', 'prompt']
    },
    output: {
      schema: { type: 'object', properties: { agent_id: { type: 'string' }, model: { type: 'string' }, status: { type: 'string' } }, required: ['agent_id', 'model', 'status'] },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!args || typeof args !== 'object' || Array.isArray(args)
        || Object.keys(args).some(key => !['description', 'prompt', 'complexity'].includes(key))) {
        throw new Error('Invalid dsh_subagent arguments; model overrides are not supported.');
      }
      const parent = exec?.agent;
      const route = parent?.session?.requestHeader?.()?.config;
      if (!parent || !route?.provider || !route?.model) throw new Error('Cannot resolve DSH parent provider/model.');
      const label = nonEmptyString(args?.description, undefined, 'description');
      const prompt = nonEmptyString(args?.prompt, undefined, 'prompt');
      const complexity = args.complexity ?? 'complex';
      if (!['simple', 'complex'].includes(complexity)) throw new Error('Invalid subagent complexity.');
      // Other providers may not expose Gemini: preserve their exact route.
      const isArgon = route.model.toLowerCase().includes('argon');
      const isClaude = route.model.startsWith('claude-');
      const useGemini = (isClaude || isArgon) && complexity === 'simple'
        && config.routeSimpleToGemini !== false && route.provider === 'localantigravity';
      const model = useGemini ? simpleModel : route.model;

      const candidateDeny = ['dsh_subagent', 'subagent', 'subagent_fork', 'parallel_task', 'workflow'];
      const tools = toolsService || parent?.ctx?.get?.('tools');
      let restrictable;
      try {
        restrictable = tools?.view?.(parent)?.restrictableNames;
      } catch {}
      const deny = restrictable instanceof Set
        ? candidateDeny.filter(name => restrictable.has(name))
        : ['dsh_subagent', 'subagent_fork', 'parallel_task', 'workflow'];

      const request = {
        parent, label,
        prompt: [{ type: 'text', text: prompt + '\n\nStay within delegated scope. Preserve unrelated changes. Report changed files, checks and unresolved issues. Do not start further agents or remote parallel tasks.' }],
        agentOptions: { provider: route.provider, model, maxTokens: positiveInteger(config.subagentMaxTokens, 65536, 'subagentMaxTokens', 1000000) },
        maxDepth: subagents.resolveMaxDepth(),
        ...(deny.length > 0 ? { toolFilter: { deny } } : {})
      };

      const startFn = typeof subagents.startActivation === 'function'
        ? (spec) => subagents.startActivation({ delivery: 'parent', ...spec })
        : (typeof subagents.startContinuable === 'function'
            ? (spec) => subagents.startContinuable(spec)
            : null);

      if (!startFn) {
        throw new Error('DSH subagents service has neither startActivation nor startContinuable.');
      }

      const started = await startFn({
        provider: 'spawn', label,
        request,
        signal: exec.signal
      });
      return { agent_id: started.childId, model, status: 'started' };
    }
  };
}

export function apply(ctx, config) {
  const logger = ctx.logger ? ctx.logger('geminapi-quotas') : console;

  ctx.inject(['tools'], (scope) => {
    scope.tools.register(createParallelTaskTool(config));
    logger.info?.('GeminApi parallel_task tool registered');
  });

  ctx.inject(['webServer'], (scope) => {
    // Native children retain the host's filesystem and permission boundary.
    // 1. GET /api/geminapi/quotas
    scope.webServer.register({
      kind: 'exact',
      path: '/api/geminapi/quotas',
      async handler(req, res) {
        if (req.method !== 'GET') {
          return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
        }
        try {
          const defaults = resolveCredentials(config);
          const customUrl = req.headers['x-geminapi-url'];
          const customKey = req.headers['x-geminapi-key'];
          const apiUrl = (typeof customUrl === 'string' && customUrl.trim()) ? customUrl.trim().replace(/\/+$/, '') : defaults.apiUrl;
          const apiKey = (typeof customKey === 'string' && customKey.trim()) ? customKey.trim() : defaults.apiKey;

          const start = Date.now();
          const authHeaders = {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          };

          const [accResponse, statusResponse] = await Promise.all([
            fetch(`${apiUrl}/admin/accounts`, { headers: authHeaders }),
            fetch(`${apiUrl}/admin/status`, { headers: authHeaders }).catch(() => null)
          ]);

          const latencyMs = Date.now() - start;

          if (!accResponse.ok) {
            const errText = await accResponse.text();
            return sendJson(res, accResponse.status, {
              ok: false,
              apiUrl,
              status: accResponse.status,
              latencyMs,
              error: `GeminApi вернул HTTP ${accResponse.status}: ${errText}`
            });
          }

          const accData = await accResponse.json();
          let gateway = null;
          if (statusResponse && statusResponse.ok) {
            try {
              const sData = await statusResponse.json();
              gateway = {
                busy: sData.busy,
                mode: sData.mode,
                active_requests: sData.active_requests || 0,
                max_concurrency: sData.max_concurrency || 4,
                upstream_host: sData.account?.upstream_host || 'daily-cloudcode-pa.googleapis.com',
                rotation: sData.rotation || 'least_tokens'
              };
            } catch {}
          }

          sendJson(res, 200, {
            ok: true,
            apiUrl,
            latencyMs,
            accounts: accData.accounts || [],
            rotation: accData.rotation || (gateway && gateway.rotation) || 'least_tokens',
            quota_refresh_seconds: accData.quota_refresh_seconds || 300,
            gateway,
            timestamp: Date.now()
          });
        } catch (err) {
          logger.warn?.('Failed to fetch quotas:', err);
          sendJson(res, 502, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now()
          });
        }
      }
    });

    // 2. POST /api/geminapi/refresh
    scope.webServer.register({
      kind: 'exact',
      path: '/api/geminapi/refresh',
      async handler(req, res) {
        if (req.method !== 'POST') {
          return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
        }
        try {
          const defaults = resolveCredentials(config);
          const body = await readBody(req);
          const apiUrl = (body.apiUrl || defaults.apiUrl).replace(/\/+$/, '');
          const apiKey = body.apiKey || defaults.apiKey;

          const start = Date.now();
          const response = await fetch(`${apiUrl}/admin/quotas/refresh`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: '{}'
          });

          const latencyMs = Date.now() - start;

          if (!response.ok) {
            const errText = await response.text();
            return sendJson(res, response.status, {
              ok: false,
              apiUrl,
              status: response.status,
              latencyMs,
              error: `Синхронизация квот завершилась с кодом HTTP ${response.status}: ${errText}`
            });
          }

          const data = await response.json();
          sendJson(res, 200, {
            ok: true,
            apiUrl,
            latencyMs,
            results: data.results,
            accounts: data.accounts || [],
            timestamp: Date.now()
          });
        } catch (err) {
          logger.warn?.('Failed to refresh quotas:', err);
          sendJson(res, 502, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now()
          });
        }
      }
    });

    // 3. GET /api/geminapi/status
    scope.webServer.register({
      kind: 'exact',
      path: '/api/geminapi/status',
      async handler(req, res) {
        try {
          const defaults = resolveCredentials(config);
          const response = await fetch(`${defaults.apiUrl}/admin/status`, {
            headers: {
              'Authorization': `Bearer ${defaults.apiKey}`
            }
          });
          if (!response.ok) {
            return sendJson(res, response.status, { ok: false, status: response.status });
          }
          const data = await response.json();
          sendJson(res, 200, {
            ok: true,
            plugin_version: '1.2.1',
            parallel_task: true,
            dsh_subagent: Boolean(ctx.get?.('subagents')),
            ...data
          });
        } catch (err) {
          sendJson(res, 502, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    });

    logger.info?.('GeminApi Quotas host endpoints registered');
  });

  ctx.inject(['tools', 'subagents'], (scope) => {
    scope.tools.register(createDshSubagentTool(scope.subagents, config, scope.tools));
    logger.info?.('GeminApi native dsh_subagent tool registered');
  });
}
