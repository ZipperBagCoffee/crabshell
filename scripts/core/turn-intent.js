'use strict';

const KOREAN_EXECUTION_PATTERNS = /해라|진행해|작업\s*진행|수정해|만들어|구현해|실행해|시작해|고쳐|적용해|재발주해|저장해|기록해|남겨줘|append\s*해/;
const ENGLISH_EXECUTION_PATTERNS = /\b(do it|proceed|continue|fix|create|implement(?:ing|ed|s)?|build(?:ing|s)?|execut(?:e|ing|ed|es)|start(?:ing|ed|s)?|apply(?:ing|ied|ies)?|append|save)\b/i;
const KOREAN_QUESTION_PATTERNS = /(?:\?|？)|(?:뭐|왜|어떻게|무슨|어디|언제|누가|설명해|알려줘|뜻이|맞아|맞냐|인가|건가|거야|하냐|하나요|해요)(?:\s|$|[?.!])/;
// "do" is interrogative ("do you...", "do we...") but NOT the imperative "do it"
const ENGLISH_QUESTION_PATTERNS = /(?:\?|^(?:what|why|how|which|where|when|who|is|are|does|do(?!\s+it\b)|can|could|would|should)\b|\b(?:explain|tell me|what does)\b)/i;

function unquotedPrompt(userPrompt) {
  // This is a conservative lifecycle hint, not permission to exceed the user's
  // scope. Quoted references and punctuation alone do not issue instructions.
  return String(userPrompt || '').replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ').replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/(?<!\w)'(?:\\.|[^'\\])*'/g, ' ').replace(/[“‘][^”’]*[”’]/g, ' ');
}

function isStopRequest(userPrompt) {
  const prompt = unquotedPrompt(userPrompt).trim();
  return /^(?:please\s+)?(?:stop|pause|cancel)(?:\s+(?:now|this|the|work|execution|task)\b|[.!]|$)/i.test(prompt)
    || /^(?:그만|멈춰|중단해|중지해|취소해|아시발멈춰|BRAINMELT)(?:\s|[.!]|$)/i.test(prompt)
    || /(?:작업|실행|진행)\s*(?:을\s*)?(?:멈춰|중단해|중지해|하지\s*마)/.test(prompt);
}

function classifyUserIntent(userPrompt) {
  if (!userPrompt) return 'default';
  const prompt = unquotedPrompt(userPrompt);
  if (isStopRequest(userPrompt)) return 'default';
  const clauses = prompt.split(/[?？!\n]+|\.\s+/).map(text => text.trim()).filter(Boolean);
  let question = false;
  for (const clause of clauses) {
    if (/\b(?:do not|don't|never)\s+(?:edit|change|fix|implement|execute|run)\b/i.test(clause)
        || /(?:수정|변경|실행)\s*하지\s*마/.test(clause)) { question = true; continue; }
    if (/^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:fix|create|implement|build|execute|run|append|save)\b/i.test(clause)) return 'execution';
    const directKoreanRequest = /(?:줘|주세요|줄래|해봐|해라|하셔)\s*$/.test(clause);
    if (/^(?:what|why|how|which|where|when|who|is|are|does|do(?!\s+it\b)|can|could|would|should|explain|tell me)\b/i.test(clause)
        || (!directKoreanRequest && /(?:^|\s)(?:왜|뭐|어떻게|무슨|어디|언제|누가)/.test(clause))) { question = true; continue; }
    const inspection = /설명|알려줘|읽어봐|확인해봐|검토|조사/.test(clause);
    const mutation = /수정|구현|고쳐|만들|재발주|저장|기록|남겨|추가|append|진행/.test(clause);
    if (inspection && !mutation) { question = true; continue; }
    if (KOREAN_EXECUTION_PATTERNS.test(clause) || ENGLISH_EXECUTION_PATTERNS.test(clause)
        || /^(?:please\s+)?run\b/i.test(clause)) return 'execution';
    if (KOREAN_QUESTION_PATTERNS.test(clause) || ENGLISH_QUESTION_PATTERNS.test(clause)) question = true;
  }
  return question || /[?？]/.test(prompt) ? 'question' : 'default';
}

module.exports = {
  ENGLISH_EXECUTION_PATTERNS,
  ENGLISH_QUESTION_PATTERNS,
  KOREAN_EXECUTION_PATTERNS,
  KOREAN_QUESTION_PATTERNS,
  classifyUserIntent,
  isStopRequest,
};
