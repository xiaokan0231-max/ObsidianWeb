#!/usr/bin/env node

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CODEX_BRIDGE_PORT || 43127);
const TOKEN = process.env.CODEX_BRIDGE_TOKEN;
const CODEX_PATH =
  process.env.CODEX_BRIDGE_CODEX_PATH ||
  "/Applications/ChatGPT.app/Contents/Resources/codex";
const SOL_MODEL = process.env.CODEX_BRIDGE_SOL_MODEL || "gpt-5.6-sol";
const TERRA_MODEL = process.env.CODEX_BRIDGE_TERRA_MODEL || "gpt-5.6-terra";
const MAX_BODY = 8 * 1024 * 1024;

if (!TOKEN || TOKEN.length < 24) {
  process.stderr.write("CODEX_BRIDGE_TOKEN must contain at least 24 characters.\n");
  process.exit(1);
}

const taskConfig = {
  rebuild_language_bank: { model: SOL_MODEL, timeoutMs: 480_000 },
  expand_language_category: { model: SOL_MODEL, timeoutMs: 360_000 },
  coach_language_output: { model: TERRA_MODEL, timeoutMs: 120_000 },
  grade_language_exam: { model: TERRA_MODEL, timeoutMs: 120_000 },
  review_interview_answers: { model: SOL_MODEL, timeoutMs: 480_000 },
};

const string = { type: "string" };
const number = { type: "number" };
const boolean = { type: "boolean" };

const languageCategory = {
  type: "string",
  enum: [
    "numbers_reading",
    "vocabulary",
    "technical_vocabulary",
    "grammar",
    "particles_collocations",
    "interview_expression",
    "business_expression",
    "delivery_buffer",
  ],
};

const languageDrillSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "type",
    "promptZh",
    "promptJa",
    "choices",
    "correctAnswer",
    "acceptedAnswers",
    "correctOrder",
    "explanationZh",
  ],
  properties: {
    type: { type: "string", enum: ["choice", "text", "ordering"] },
    promptZh: string,
    promptJa: string,
    choices: { type: "array", items: string },
    correctAnswer: string,
    acceptedAnswers: { type: "array", items: string },
    correctOrder: { type: "array", items: string },
    explanationZh: string,
  },
};

const languageQuestionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "unitId",
    "category",
    "type",
    "promptZh",
    "promptJa",
    "choices",
    "correctAnswer",
    "acceptedAnswers",
    "correctOrder",
    "rubricZh",
  ],
  properties: {
    unitId: string,
    category: languageCategory,
    type: {
      type: "string",
      enum: ["choice", "text", "ordering", "free_response"],
    },
    promptZh: string,
    promptJa: string,
    choices: { type: "array", items: string },
    correctAnswer: string,
    acceptedAnswers: { type: "array", items: string },
    correctOrder: { type: "array", items: string },
    rubricZh: string,
  },
};

const languageDimensions = {
  type: "object",
  additionalProperties: false,
  required: [
    "meaning",
    "grammar",
    "naturalness",
    "register",
    "speakability",
    "factSafety",
  ],
  properties: {
    meaning: number,
    grammar: number,
    naturalness: number,
    register: number,
    speakability: number,
    factSafety: number,
  },
};

const reviewDimension = {
  type: "object",
  additionalProperties: false,
  required: ["score", "rationaleZh", "evidenceBlockIds"],
  properties: {
    score: number,
    rationaleZh: string,
    evidenceBlockIds: { type: "array", items: string },
  },
};

const schemas = {
  rebuild_language_bank: {
    type: "object",
    additionalProperties: false,
    required: ["summaryZh", "immediateAdviceZh", "units", "questionBank"],
    properties: {
      summaryZh: string,
      immediateAdviceZh: string,
      units: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "canonicalKey",
            "category",
            "titleZh",
            "targetJa",
            "reading",
            "meaningZh",
            "usageZh",
            "register",
            "exampleKind",
            "exampleJa",
            "alternativesJa",
            "commonErrorJa",
            "correctedJa",
            "errorReasonZh",
            "cautionZh",
            "evidence",
            "factSensitive",
            "factSourcePaths",
            "relatedDojoItemIds",
            "priority",
            "drills",
          ],
          properties: {
            canonicalKey: string,
            category: languageCategory,
            titleZh: string,
            targetJa: string,
            reading: string,
            meaningZh: string,
            usageZh: string,
            register: { type: "string", enum: ["interview", "business", "both"] },
            exampleKind: { type: "string", enum: ["general", "personal"] },
            exampleJa: string,
            alternativesJa: { type: "array", items: string },
            commonErrorJa: string,
            correctedJa: string,
            errorReasonZh: string,
            cautionZh: string,
            evidence: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["path", "excerpt"],
                properties: { path: string, excerpt: string },
              },
            },
            factSensitive: boolean,
            factSourcePaths: { type: "array", items: string },
            relatedDojoItemIds: { type: "array", items: string },
            priority: number,
            drills: { type: "array", items: languageDrillSchema },
          },
        },
      },
      questionBank: { type: "array", items: languageQuestionSchema },
    },
  },
  coach_language_output: {
    type: "object",
    additionalProperties: false,
    required: ["summaryZh", "factualRisk", "unitFeedbacks"],
    properties: {
      summaryZh: string,
      factualRisk: boolean,
      unitFeedbacks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "unitId",
            "meaning",
            "grammar",
            "naturalness",
            "register",
            "speakability",
            "factSafety",
            "criticalError",
            "feedbackZh",
            "correctedJa",
          ],
          properties: {
            unitId: string,
            ...languageDimensions.properties,
            criticalError: boolean,
            feedbackZh: string,
            correctedJa: string,
          },
        },
      },
    },
  },
  grade_language_exam: {
    type: "object",
    additionalProperties: false,
    required: ["grades"],
    properties: {
      grades: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "questionId",
            "unitId",
            "score",
            "dimensions",
            "criticalError",
            "feedbackZh",
            "improvedAnswerJa",
          ],
          properties: {
            questionId: string,
            unitId: string,
            score: number,
            dimensions: languageDimensions,
            criticalError: boolean,
            feedbackZh: string,
            improvedAnswerJa: string,
          },
        },
      },
    },
  },
  review_interview_answers: {
    type: "object",
    additionalProperties: false,
    required: [
      "dimensions",
      "summaryZh",
      "strengths",
      "weaknesses",
      "priorityBlockIds",
      "blocks",
    ],
    properties: {
      dimensions: {
        type: "object",
        additionalProperties: false,
        required: [
          "questionUnderstanding",
          "coverage",
          "directness",
          "evidenceCredibility",
          "riskControl",
        ],
        properties: {
          questionUnderstanding: reviewDimension,
          coverage: reviewDimension,
          directness: reviewDimension,
          evidenceCredibility: reviewDimension,
          riskControl: reviewDimension,
        },
      },
      summaryZh: string,
      strengths: { type: "array", items: string },
      weaknesses: { type: "array", items: string },
      priorityBlockIds: { type: "array", items: string },
      blocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "blockId",
            "questionTitle",
            "interviewerIntentZh",
            "askedPoints",
            "answeredPoints",
            "missedPoints",
            "comprehension",
            "relevance",
            "quality",
            "strategyTags",
            "evidenceSentenceIds",
            "evaluationZh",
            "improvementZh",
            "improvedAnswerJa",
          ],
          properties: {
            blockId: string,
            questionTitle: string,
            interviewerIntentZh: string,
            askedPoints: { type: "array", items: string },
            answeredPoints: { type: "array", items: string },
            missedPoints: { type: "array", items: string },
            comprehension: {
              type: "string",
              enum: ["clear", "partial", "likely_missed"],
            },
            relevance: {
              type: "string",
              enum: ["direct", "partial", "off_target"],
            },
            quality: {
              type: "string",
              enum: ["strong", "mixed", "weak", "neutral"],
            },
            strategyTags: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "compound-question-miss",
                  "no-conclusion-first",
                  "negative-oversharing",
                  "weak-evidence",
                  "over-absolute",
                  "role-mismatch",
                  "numbers-confusion",
                ],
              },
            },
            evidenceSentenceIds: { type: "array", items: string },
            evaluationZh: string,
            improvementZh: string,
            improvedAnswerJa: string,
          },
        },
      },
    },
  },
};

schemas.expand_language_category = schemas.rebuild_language_bank;

const commonInstruction = `你是“日语面试训练场”的受限分析器。你不能调用工具、访问文件或执行命令；只能使用 INPUT_JSON 中的资料。解释和反馈用简体中文，需要用户练习或直接使用的面试表达用自然、可在压力下说出口的日语。严格区分资料可信度：self 是本人确认的权威事实；transcript/review/company/policy 是证据；material 和 ai-report 只能是候选线索，未经 self 或 transcript/review 支持不得写成用户已做过的事实。不得虚构经历、数字、公司要求。`;

function buildPrompt(task, payload) {
  const instructions = {
    rebuild_language_bank: `建立独立的个性化日语训练库，重点是主动词汇、读音、语法、搭配、面试表达、必要商务表达和卡顿救场，不生成完整面试答案课程。生成36个不重复、高价值单元，不得用通用JLPT内容凑数；八个category都要根据资料覆盖。每个单元的drills必须返回空数组，服务器会根据targetJa和reading自动建立两道固定练习；questionBank也必须返回空数组，服务器会自动建立客观题，并为语法、搭配、面试表达、商务表达、卡顿救场补充开放造句题。不要生成任何题目内容。内容务求短而可训练：meaningZh、usageZh、errorReasonZh、cautionZh各1句，alternativesJa最多2条，evidence最多2条。INPUT_JSON.previousUnits 中同一能力点必须原样复用canonicalKey。个人经历、数字、薪资、项目或公司事实只能引用authority/evidence路径，并将exampleKind设为personal、factSensitive设为true、factSourcePaths列出来源；material/study/ai-report只可用于发现错误或通用语言知识，不得升级为个人事实。旧笔记中的10亿件、600万円、YOLO等若没有权威或直接证据，绝不能进入个人例句。relatedDojoItemIds只能使用输入提供的真实道场ID。`,
    expand_language_category: `只扩充 INPUT_JSON.category 指定的一个日语训练分类，生成 INPUT_JSON.requestedCount 个与 existingUnits 不重复的新单元。优先覆盖用户技术栈、逐字稿缺词、近期目标公司和真实面试需要；专业词汇不仅要有产品名，还要覆盖架构、设计、开发、测试、运维、性能、AI/GPU和管理沟通中确实相关的术语。不得为了数量生成低价值近义重复。每个单元的 drills 和顶层 questionBank 都必须返回空数组，由服务器生成练习。meaningZh、usageZh、errorReasonZh、cautionZh各1句，alternativesJa最多2条，evidence最多2条。canonicalKey必须是新的稳定短英文键；不得复用 existingUnits 中已有的canonicalKey或targetJa。个人经历和数字仍严格执行事实层级；没有权威证据时只能用general例句，不能说成用户做过。relatedDojoItemIds只能使用输入提供的真实ID。summaryZh简要说明本次扩充重点，immediateAdviceZh给出本类最先学习的方向。`,
    coach_language_output: `一次性检查本次训练中用户写的全部造句。逐单元判断原意、语法、自然度、面试/商务语域、可说出口程度和事实安全，各维度1-5分。只使用附带单元和已确认来源，不补全经历。发现意思反转、数字错误、虚构经历或把候选事实当本人事实时criticalError和factualRisk必须为true。每个句子给简短中文反馈和一条自然日语改写。`,
    grade_language_exam: `一次性批改全部日语训练开放题。六个维度各打1-5分，score为0-100。保持原意、语法、自然度、面试或商务语域、压力下可说出口和事实安全都要评价。事实错误、虚构经历、意思反转、高风险数字或明显不适合面试的表达必须criticalError=true。反馈用简体中文并给可直接复练的自然日语。`,
    review_interview_answers: `Use $review-interview-answers in Bridge mode. 对一场已完成人工证据裁定的面试做“回答质量复盘”。这不是语法纠错：核心是识别面试官真正问了什么、一个问题包含哪些子问、候选人实际覆盖了哪些、遗漏了哪些、是否答非所问，以及回答策略在日本面试中是否制造不必要风险。必须逐个分析 INPUT_JSON.blocks 中有实质问答的块；寒暄、流程确认和纯结束语可以给 neutral，但不得编造问题。重点检查复合问题和追问链：如果面试官同时问 AI、MCP、DDD，而回答只覆盖 DDD，必须明确列出 AI/MCP 为 missedPoints，并结合本人批注判断 likely_missed 或 partial。只能引用 INPUT_JSON 的逐句证据、本人批注和 humanFeedback；humanFeedback 中的 disagree/补充事实优先于旧 AI 结论，必须明确重新核对，不能机械重复被否定的判断。existingReview 只是旧分析线索，不能覆盖逐字证据。评价好坏都列 evidenceSentenceIds。improvedAnswerJa 应短、直接、先回答全部子问，再补证据；没有必要改写的块返回空字符串。每个问题按实际情况附 strategyTags，只能使用给定枚举，不能为了填标签而滥加。日本面试风险关注主动暴露负面材料、贬低前同事/领导、过度绝对化、薪资与转职理由、缺少结论先行等回答策略，但不要把文化刻板印象当事实。dimensions 必须分别评价问题理解、覆盖完整度、直接性、证据可信度、风险控制，每项0-100，并用 rationaleZh 解释、用 evidenceBlockIds 引用 qNN；五项等权，服务器会据此计算总分，不要另行输出总分。priorityBlockIds 只列最值得重听和重练的块，最多8个。`,
  }[task];
  return `${commonInstruction}\n\nTASK_INSTRUCTION:\n${instructions}\n\nINPUT_JSON:\n${JSON.stringify(payload)}`;
}

function safeEnvironment() {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.CODEX_BRIDGE_TOKEN;
  return env;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: safeEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutMs = options.timeoutMs || 15_000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_500).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        if (timedOut) {
          const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
          reject(
            new Error(
              `本地 Codex 在${minutes}分钟内未完成，任务已安全停止。Vault 没有写入任何不完整内容，也不会切换到收费 API。请重试一次。`,
            ),
          );
          return;
        }
        const detail = stderr
          .replace(/\u001b\[[0-9;]*m/g, "")
          .trim()
          .split("\n")
          .filter((line) => line.length < 800 && !line.trimStart().startsWith("{"))
          .slice(-3)
          .join(" ")
          .slice(-900);
        reject(
          new Error(
            signal
              ? `Codex 任务被系统终止（${signal}）。${detail}`
              : `Codex 运行失败（退出码 ${code}）。${detail}`,
          ),
        );
      }
    });
    child.stdin.end(options.stdin || "");
  });
}

let version;
let authentication = "unknown";
let lastError;
let active = false;
let queueDepth = 0;
let queue = Promise.resolve();

async function checkRuntime() {
  try {
    const [versionResult, loginResult] = await Promise.all([
      runProcess(CODEX_PATH, ["--version"], { timeoutMs: 10_000 }),
      runProcess(CODEX_PATH, ["login", "status"], { timeoutMs: 15_000 }),
    ]);
    version = versionResult.stdout.trim() || versionResult.stderr.trim();
    const login = `${loginResult.stdout}\n${loginResult.stderr}`;
    if (/using ChatGPT/i.test(login)) authentication = "chatgpt";
    else if (/api.?key/i.test(login)) authentication = "api-key";
    else authentication = "unknown";
    if (authentication !== "chatgpt") {
      throw new Error(
        authentication === "api-key"
          ? "Codex 当前使用 API key 登录。Bridge 已拒绝运行，请切换为 ChatGPT 登录。"
          : "无法确认 Codex 为 ChatGPT 登录，请先运行 codex login。",
      );
    }
    lastError = undefined;
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return false;
  }
}

async function executeTask(task, payload) {
  if (!(await checkRuntime())) throw new Error(lastError);
  const config = taskConfig[task];
  const directory = await mkdtemp(join(tmpdir(), "obsidian-dojo-"));
  try {
    const schemaPath = join(directory, "output.schema.json");
    await writeFile(schemaPath, JSON.stringify(schemas[task]), "utf8");
    const result = await runProcess(
      CODEX_PATH,
      [
        "--ask-for-approval",
        "never",
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "-m",
        config.model,
        "--output-schema",
        schemaPath,
        "-",
      ],
      {
        cwd: directory,
        timeoutMs: config.timeoutMs,
        stdin: buildPrompt(task, payload),
      },
    );
    let parsed;
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      throw new Error("Codex 返回的结构化 JSON 无法解析。请稍后重试。");
    }
    return { output: parsed, model: config.model };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function statusPayload() {
  return {
    bridge: authentication === "chatgpt" ? (active ? "busy" : "ready") : "misconfigured",
    codexVersion: version,
    authentication,
    safeBilling: authentication === "chatgpt",
    queueDepth,
    lastError,
  };
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("请求内容超过 8MB 限制。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    json(response, 401, { error: "Unauthorized" });
    return;
  }
  if (request.method === "GET" && request.url === "/status") {
    await checkRuntime();
    json(response, 200, statusPayload());
    return;
  }
  if (request.method !== "POST" || request.url !== "/invoke") {
    json(response, 404, { error: "Not found" });
    return;
  }
  try {
    const body = await readBody(request);
    const task = body.task;
    if (!Object.hasOwn(taskConfig, task)) {
      json(response, 400, { error: "不允许的 Codex 任务类型。" });
      return;
    }
    if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
      json(response, 400, { error: "任务 payload 格式无效。" });
      return;
    }
    if (queueDepth >= 4) {
      json(response, 429, { error: "Codex 任务队列已满，请稍后再试。" });
      return;
    }
    queueDepth += 1;
    const work = queue.then(async () => {
      active = true;
      try {
        return await executeTask(task, body.payload);
      } finally {
        active = false;
        queueDepth -= 1;
      }
    });
    queue = work.catch(() => undefined);
    const result = await work;
    lastError = undefined;
    json(response, 200, result);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    json(response, /登录|API key/.test(lastError) ? 412 : 502, {
      error: lastError,
      runtime: statusPayload(),
    });
  }
});

await checkRuntime();
server.listen(PORT, HOST, () => {
  process.stdout.write(
    `Local Codex Bridge listening on http://${HOST}:${PORT} (${authentication})\n`,
  );
});
