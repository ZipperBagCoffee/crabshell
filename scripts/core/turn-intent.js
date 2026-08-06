'use strict';

const KOREAN_EXECUTION_PATTERNS = /해라|진행해|수정해|만들어|구현해|실행해|시작해|고쳐|적용해/;
const ENGLISH_EXECUTION_PATTERNS = /\b(do it|proceed|continue|fix it|create|implement(?:ing|ed|s)?|build(?:ing|s)?|execut(?:e|ing|ed|es)|start(?:ing|ed|s)?|apply(?:ing|ied|ies)?)\b/i;
const KOREAN_QUESTION_PATTERNS = /(?:\?|？)|(?:뭐|왜|어떻게|무슨|어디|언제|누가|설명해|알려줘|뜻이|맞아|맞냐|인가|건가|거야|하냐|하나요|해요)(?:\s|$|[?.!])/;
// "do" is interrogative ("do you...", "do we...") but NOT the imperative "do it"
const ENGLISH_QUESTION_PATTERNS = /(?:\?|^(?:what|why|how|which|where|when|who|is|are|does|do(?!\s+it\b)|can|could|would|should)\b|\b(?:explain|tell me|what does)\b)/i;

function classifyUserIntent(userPrompt) {
  if (!userPrompt) return 'default';
  const prompt = String(userPrompt);
  if (KOREAN_QUESTION_PATTERNS.test(prompt) || ENGLISH_QUESTION_PATTERNS.test(prompt.trim())) return 'question';
  if (KOREAN_EXECUTION_PATTERNS.test(prompt)) return 'execution';
  if (ENGLISH_EXECUTION_PATTERNS.test(prompt)) return 'execution';
  return 'default';
}

module.exports = {
  ENGLISH_EXECUTION_PATTERNS,
  ENGLISH_QUESTION_PATTERNS,
  KOREAN_EXECUTION_PATTERNS,
  KOREAN_QUESTION_PATTERNS,
  classifyUserIntent,
};
