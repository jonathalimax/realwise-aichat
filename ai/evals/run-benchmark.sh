#!/usr/bin/env bash
set -euo pipefail

MODELS=("qwen2.5:7b-instruct-q4_K_M" "llama3.1:8b-instruct-q4_K_M")
QUESTIONS_FILE="$(dirname "$0")/pt-br-questions.json"
OUT_DIR="$(dirname "$0")/results"
mkdir -p "$OUT_DIR"

SYSTEM_PROMPT="Você é o atendente de uma imobiliária/concessionária brasileira. Responda em português brasileiro natural, direto, sem gírias de IA. Se não souber a resposta exata, diga que vai confirmar com um atendente humano."

for MODEL in "${MODELS[@]}"; do
  SAFE_NAME=$(echo "$MODEL" | tr ':/' '__')
  OUT_FILE="$OUT_DIR/${SAFE_NAME}.jsonl"
  : > "$OUT_FILE"

  python3 -c "
import json
d = json.load(open('$QUESTIONS_FILE'))
for niche, qs in d.items():
    for q in qs:
        print(json.dumps({'niche': niche, 'question': q}))
" > /tmp/rw_bench_questions.jsonl

  while IFS= read -r line; do
    NICHE=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['niche'])" "$line")
    Q=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['question'])" "$line")

    PAYLOAD=$(python3 -c "
import json, sys
prompt = sys.argv[1] + chr(10) + chr(10) + 'Cliente: ' + sys.argv[2]
print(json.dumps({'model': sys.argv[3], 'prompt': prompt, 'stream': False}))
" "$SYSTEM_PROMPT" "$Q" "$MODEL")

    START=$(date +%s%N)
    RESPONSE=$(curl -s http://localhost:11434/api/generate -d "$PAYLOAD")
    END=$(date +%s%N)
    LATENCY_MS=$(( (END - START) / 1000000 ))

    python3 -c "
import json, sys
resp = json.loads(sys.argv[1])
out = {
  'niche': sys.argv[2],
  'question': sys.argv[3],
  'answer': resp.get('response', ''),
  'latency_ms': int(sys.argv[4]),
}
print(json.dumps(out, ensure_ascii=False))
" "$RESPONSE" "$NICHE" "$Q" "$LATENCY_MS" >> "$OUT_FILE"

    echo "[$MODEL] ($NICHE) ${LATENCY_MS}ms :: $Q"
  done < /tmp/rw_bench_questions.jsonl
done

rm -f /tmp/rw_bench_questions.jsonl
echo "Done. Results in $OUT_DIR"
